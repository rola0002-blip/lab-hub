import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools.js'

let client: Client
let fetchMock: ReturnType<typeof vi.fn>

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const statusResponse = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body })

beforeEach(async () => {
  vi.stubEnv('LABHUB_API_KEY', 'test-key')
  vi.stubEnv('LABHUB_URL', 'http://localhost:3000')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  const server = new McpServer({ name: 'test', version: '0' })
  registerTools(server)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'test', version: '0' }, { capabilities: {} })
  await client.connect(clientTransport)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
  (await client.callTool({ name, arguments: args })) as ToolResult

const payload = (result: ToolResult): unknown => JSON.parse(result.content[0]!.text)

const lastCall = (): { url: string; init: RequestInit } => {
  const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit]
  return { url, init }
}

describe('request building', () => {
  it('sends the bearer key and hits the configured base url', async () => {
    fetchMock.mockResolvedValue(okResponse({ users: [{ id: 'colossus-bot', name: 'LabHub Bot', isSystem: true }, { id: 'u1', name: 'Human', isSystem: false }] }))
    const result = await call('whoami')
    expect(result.isError).toBeUndefined()
    const { url, init } = lastCall()
    expect(url).toBe('http://localhost:3000/api/chat/users')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    expect(payload(result)).toEqual({ id: 'colossus-bot', name: 'LabHub Bot', isSystem: true })
  })

  it('honours LABHUB_URL and trims a trailing slash', async () => {
    vi.stubEnv('LABHUB_URL', 'http://labhub.internal:3000/')
    fetchMock.mockResolvedValue(okResponse({ ok: true, version: '0.29.0' }))
    await call('health')
    expect(lastCall().url).toBe('http://labhub.internal:3000/api/health')
  })

  it('read_messages defaults take=30, passes the cursor, and encodes the conversation id', async () => {
    fetchMock.mockResolvedValue(okResponse({ messages: [], hasMore: false, firstUnreadId: null }))
    await call('read_messages', { conversationId: 'team/general', before: 'msg_9' })
    const { url } = lastCall()
    expect(url).toBe('http://localhost:3000/api/chat/conversations/team%2Fgeneral/messages?take=30&before=msg_9')
  })

  it('send_message posts the body without parentId when unset', async () => {
    fetchMock.mockResolvedValue(statusResponse(201, { message: { id: 'm1' } }))
    await call('send_message', { conversationId: 'c1', body: 'ship it <!channel>' })
    const { url, init } = lastCall()
    expect(url).toBe('http://localhost:3000/api/chat/messages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: 'c1', body: 'ship it <!channel>' })
  })

  it('send_message threads on parentId', async () => {
    fetchMock.mockResolvedValue(statusResponse(201, { message: { id: 'm2' } }))
    await call('send_message', { conversationId: 'c1', body: 'reply', parentId: 'm1' })
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ conversationId: 'c1', body: 'reply', parentId: 'm1' })
  })

  it('dm_user creates-or-gets the DM, then sends, and returns both ids', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(200, { conversationId: 'dm1' }))
    fetchMock.mockResolvedValueOnce(statusResponse(201, { message: { id: 'm1' } }))
    const result = await call('dm_user', { userId: 'u1', body: 'ping' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3000/api/chat/conversations/dm')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ userIds: ['u1'] })
    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:3000/api/chat/messages')
    expect(payload(result)).toEqual({ conversationId: 'dm1', messageId: 'm1' })
  })

  it('list_issues passes filters through as query params', async () => {
    fetchMock.mockResolvedValue(okResponse({ issues: [] }))
    await call('list_issues', { status: 'IN_PROGRESS', assignee: 'u1' })
    expect(lastCall().url).toBe('http://localhost:3000/api/issues?status=IN_PROGRESS&assignee=u1')
  })

  it('create_booking passes the recurring block through untouched', async () => {
    fetchMock.mockResolvedValue(statusResponse(201, { ok: true, pending: true, count: 6 }))
    const recurring = {
      daysOfWeek: [1, 3, 5],
      startMinutes: 540,
      durationMinutes: 120,
      firstDate: '2026-09-14',
      untilDate: '2026-10-30',
    }
    await call('create_booking', {
      equipmentId: 'e1',
      startsAt: '2026-09-14T01:00:00Z',
      endsAt: '2026-09-14T03:00:00Z',
      purpose: 'ALD run',
      recurring,
    })
    const { url, init } = lastCall()
    expect(url).toBe('http://localhost:3000/api/bookings')
    expect(JSON.parse(init.body as string)).toEqual({
      equipmentId: 'e1',
      startsAt: '2026-09-14T01:00:00Z',
      endsAt: '2026-09-14T03:00:00Z',
      purpose: 'ALD run',
      recurring,
    })
  })

  it('cancel_booking issues a DELETE with the encoded id', async () => {
    fetchMock.mockResolvedValue(okResponse({ ok: true }))
    await call('cancel_booking', { bookingId: 'b/1' })
    const { url, init } = lastCall()
    expect(url).toBe('http://localhost:3000/api/bookings/b%2F1')
    expect(init.method).toBe('DELETE')
  })

  it('update_issue PATCHes only the changed fields, without issueId', async () => {
    fetchMock.mockResolvedValue(okResponse({ issue: { id: 'i1', status: 'DONE' } }))
    await call('update_issue', { issueId: 'i1', status: 'DONE', assigneeId: null })
    const { url, init } = lastCall()
    expect(url).toBe('http://localhost:3000/api/issues/i1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ status: 'DONE', assigneeId: null })
  })

  it('create_project mirrors the accepted project fields', async () => {
    fetchMock.mockResolvedValue(statusResponse(201, { project: { id: 'p1' } }))
    await call('create_project', {
      name: 'BN growth',
      description: 'hBN on Cu',
      startDate: '2026-09-14',
      targetDate: '2026-12-31',
    })
    const { url, init } = lastCall()
    expect(url).toBe('http://localhost:3000/api/projects')
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'BN growth',
      description: 'hBN on Cu',
      startDate: '2026-09-14',
      targetDate: '2026-12-31',
    })
  })
})

describe('tool behaviors', () => {
  it('list_users drops system users unless includeBot is set', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        users: [
          { id: 'u1', name: 'Roland', isSystem: false },
          { id: 'colossus-bot', name: 'LabHub Bot', isSystem: true },
        ],
      }),
    )
    expect(payload(await call('list_users'))).toEqual({ users: [{ id: 'u1', name: 'Roland', isSystem: false }] })
    expect((payload(await call('list_users', { includeBot: true })) as { users: unknown[] }).users).toHaveLength(2)
  })

  it('maps a non-2xx response to a tool error with status and machine code', async () => {
    fetchMock.mockResolvedValue(statusResponse(409, { error: 'slot_taken', message: 'That time was just taken. Pick another slot.' }))
    const result = await call('create_booking', { equipmentId: 'e1', startsAt: '2026-09-14T01:00:00Z', endsAt: '2026-09-14T02:00:00Z' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('LabHub 409 slot_taken')
    expect(result.content[0]!.text).toContain('That time was just taken.')
  })

  it('names the cause on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const result = await call('list_conversations')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Could not reach LabHub at http://localhost:3000')
  })

  it('names the cause on a timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    const result = await call('list_equipment')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('timed out after 15s')
  })

  it('update_issue with no changes returns a clear error without calling the API', async () => {
    const result = await call('update_issue', { issueId: 'i1' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('at least one field')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects out-of-range inputs via zod before any request', async () => {
    const result = await call('read_messages', { conversationId: 'c1', take: 101 })
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('truncates oversized payloads', async () => {
    fetchMock.mockResolvedValue(okResponse({ blob: 'a'.repeat(60_000) }))
    const result = await call('search_chat', { q: 'x' })
    const text = result.content[0]!.text
    expect(text.length).toBeLessThanOrEqual(50_200)
    expect(text.endsWith('…[truncated at 50KB]')).toBe(true)
  })
})
