import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, LabHubApiError, LabHubNetworkError, qs, request, toText } from './client.js'

type Result = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

const ok = (data: unknown): Result => ({ content: [{ type: 'text', text: toText(data) }] })

const fail = (e: unknown): Result => ({
  content: [
    {
      type: 'text',
      text:
        e instanceof LabHubApiError || e instanceof LabHubNetworkError
          ? e.message
          : `labhub-mcp error: ${e instanceof Error ? e.message : String(e)}`,
    },
  ],
  isError: true,
})

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return ok(await fn())
  } catch (e) {
    return fail(e)
  }
}

const isoInstant = z.iso.datetime({ offset: true })
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const issueStatus = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'])
const issuePriority = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'])

const recurringSchema = z.object({
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .describe('Weekdays to book, 0=Sunday … 6=Saturday'),
  startMinutes: z.number().int().min(0).max(1439).describe('Start time in minutes from midnight, org timezone'),
  durationMinutes: z.number().int().min(15).max(1440),
  firstDate: isoDay.describe('First occurrence date, yyyy-MM-dd'),
  untilDate: isoDay.describe('Last occurrence date (inclusive), yyyy-MM-dd'),
})

const bookingBody = {
  equipmentId: z.string().min(1),
  startsAt: isoInstant.describe('Booking start, ISO-8601'),
  endsAt: isoInstant.describe('Booking end, ISO-8601'),
  purpose: z.string().max(500).optional(),
  recurring: recurringSchema.optional(),
}

type UsersResponse = { users?: Array<{ isSystem?: boolean }> }
type DmResponse = { conversationId?: string }
type SentMessageResponse = { message?: { id?: string } }

export function registerTools(server: McpServer): void {
  server.registerTool(
    'health',
    {
      description:
        'Check LabHub liveness and version (GET /api/health, no auth). Use first to confirm the server is reachable.',
    },
    async () => run(() => get('/api/health')),
  )

  server.registerTool(
    'whoami',
    {
      description:
        'Return the identity the LABHUB_API_KEY resolves to (the LabHub Bot). Use to verify the service key is valid.',
    },
    async () => run(() => get('/api/me')),
  )

  server.registerTool(
    'list_users',
    {
      description:
        'List lab members (id, name, role) for mentions, DMs and issue assignment; system/bot users are dropped unless includeBot is true.',
      inputSchema: {
        includeBot: z.boolean().default(false).describe('Include system users (the LabHub Bot)'),
      },
    },
    async ({ includeBot }) =>
      run(async () => {
        const data = (await get('/api/chat/users')) as UsersResponse
        const users = Array.isArray(data.users) ? data.users.filter((u) => includeBot || !u.isSystem) : []
        return { users }
      }),
  )

  server.registerTool(
    'list_conversations',
    {
      description:
        'List chat conversations (channels and DMs) visible to the bot, with ids needed to read or send messages.',
    },
    async () => run(() => get('/api/chat/conversations')),
  )

  server.registerTool(
    'read_messages',
    {
      description:
        'Read recent messages from a chat conversation, newest first. Page older history with `before` set to the oldest message id returned.',
      inputSchema: {
        conversationId: z.string().min(1),
        take: z.number().int().min(1).max(100).default(30).describe('Messages to fetch (default 30)'),
        before: z.string().min(1).optional().describe('Message id cursor: return messages older than this'),
      },
    },
    async ({ conversationId, take, before }) =>
      run(() =>
        get(
          `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages${qs({ take: String(take), before })}`,
        ),
      ),
  )

  server.registerTool(
    'send_message',
    {
      description:
        'Send a chat message to a conversation. Mention users with <@userId> tokens and everyone with <!channel>; pass parentId to reply in a thread.',
      inputSchema: {
        conversationId: z.string().min(1),
        body: z.string().min(1).max(4000).describe('Message text; <@userId> and <!channel> create mentions'),
        parentId: z.string().min(1).optional().describe('Message id to reply to (thread reply)'),
      },
    },
    async ({ conversationId, body, parentId }) =>
      run(() => request('/api/chat/messages', { method: 'POST', body: { conversationId, body, parentId } })),
  )

  server.registerTool(
    'dm_user',
    {
      description:
        'Direct-message a user: finds or creates the 1:1 DM conversation, sends the text, returns {conversationId, messageId}. Use instead of send_message for private replies.',
      inputSchema: {
        userId: z.string().min(1),
        body: z.string().min(1).max(4000).describe('Message text; <@userId> tokens create mentions'),
      },
    },
    async ({ userId, body }) =>
      run(async () => {
        const dm = (await request('/api/chat/conversations/dm', { method: 'POST', body: { userIds: [userId] } })) as DmResponse
        const sent = (await request('/api/chat/messages', {
          method: 'POST',
          body: { conversationId: dm.conversationId, body },
        })) as SentMessageResponse
        return { conversationId: dm.conversationId, messageId: sent.message?.id }
      }),
  )

  server.registerTool(
    'search_chat',
    {
      description: 'Search chat messages by text; optionally scope to one conversation with conversationId.',
      inputSchema: {
        q: z.string().min(1),
        conversationId: z.string().min(1).optional(),
      },
    },
    async ({ q, conversationId }) => run(() => get(`/api/chat/search${qs({ q, cid: conversationId })}`)),
  )

  server.registerTool(
    'list_equipment',
    {
      description:
        'List active bookable equipment (id, name, policies, limits) — the ids required by booking tools.',
    },
    async () => run(() => get('/api/equipment')),
  )

  server.registerTool(
    'get_availability',
    {
      description:
        'List existing bookings in a time window (default: next 7 days) to find free slots before booking. Filter by equipmentId; from/to are ISO-8601.',
      inputSchema: {
        equipmentId: z.string().min(1).optional(),
        from: isoInstant.optional(),
        to: isoInstant.optional(),
      },
    },
    async ({ equipmentId, from, to }) => run(() => get(`/api/bookings${qs({ equipmentId, from, to })}`)),
  )

  server.registerTool(
    'preview_booking',
    {
      description:
        'Dry-run a booking request: reports policy verdict and conflicts without creating anything. Use before create_booking.',
      inputSchema: bookingBody,
    },
    async (args) => run(() => request('/api/bookings/preview', { method: 'POST', body: args })),
  )

  server.registerTool(
    'create_booking',
    {
      description:
        'Create an equipment booking (single or weekly-recurring). Call preview_booking or get_availability first to avoid conflicts.',
      inputSchema: bookingBody,
    },
    async (args) => run(() => request('/api/bookings', { method: 'POST', body: args })),
  )

  server.registerTool(
    'cancel_booking',
    {
      description: 'Cancel a booking by id. Only bookings made by the bot identity can be cancelled.',
      inputSchema: {
        bookingId: z.string().min(1),
      },
    },
    async ({ bookingId }) =>
      run(() => request(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: 'DELETE' })),
  )

  server.registerTool(
    'list_issues',
    {
      description: 'List issues (LAB-n); filter by status, priority, assignee, project or label id.',
      inputSchema: {
        status: issueStatus.optional(),
        priority: issuePriority.optional(),
        assignee: z.string().min(1).optional().describe('User id'),
        project: z.string().min(1).optional().describe('Project id'),
        label: z.string().min(1).optional().describe('Label id'),
      },
    },
    async (args) => run(() => get(`/api/issues${qs(args as Record<string, string | undefined>)}`)),
  )

  server.registerTool(
    'get_issue',
    {
      description: 'Fetch one issue with full detail (description, comments context, labels) by id.',
      inputSchema: {
        issueId: z.string().min(1),
      },
    },
    async ({ issueId }) => run(() => get(`/api/issues/${encodeURIComponent(issueId)}`)),
  )

  server.registerTool(
    'create_issue',
    {
      description:
        'Create an issue (title required; status/priority/assignee/project/dueDate/labels optional). Returns the created issue with its LAB-n identifier.',
      inputSchema: {
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        status: issueStatus.optional(),
        priority: issuePriority.optional(),
        assigneeId: z.string().nullable().optional().describe('User id, or null to unassign'),
        projectId: z.string().nullable().optional().describe('Project id, or null to remove from project'),
        dueDate: z
          .union([isoDay, isoInstant])
          .nullable()
          .optional()
          .describe('Due date (yyyy-MM-dd or ISO datetime), or null to clear'),
        labelIds: z.array(z.string()).optional(),
      },
    },
    async (args) => run(() => request('/api/issues', { method: 'POST', body: args })),
  )

  server.registerTool(
    'update_issue',
    {
      description:
        'Partially update an issue (any of title, description, status, priority, assignee, project, due date, labels). Pass null to clear a nullable field.',
      inputSchema: {
        issueId: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        status: issueStatus.optional(),
        priority: issuePriority.optional(),
        assigneeId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        dueDate: z.union([isoDay, isoInstant]).nullable().optional(),
        labelIds: z.array(z.string()).optional(),
      },
    },
    async ({ issueId, ...changes }) => {
      if (!Object.keys(changes).length) {
        return fail(new Error('update_issue requires at least one field to change'))
      }
      return run(() => request(`/api/issues/${encodeURIComponent(issueId)}`, { method: 'PATCH', body: changes }))
    },
  )

  server.registerTool(
    'list_projects',
    {
      description: 'List projects (id, name, status) — the ids required to scope issues and create_project fields.',
    },
    async () => run(() => get('/api/projects')),
  )

  server.registerTool(
    'create_project',
    {
      description:
        'Create a project (name required; description, lead, dates and status optional). Dates are calendar days, yyyy-MM-dd.',
      inputSchema: {
        name: z.string().trim().min(1).max(120),
        description: z.string().max(4000).optional(),
        leadId: z.string().nullable().optional().describe('User id of the project lead, or null'),
        documentFolderId: z.string().nullable().optional().describe('Linked Files folder id, or null'),
        startDate: isoDay.nullable().optional(),
        targetDate: isoDay.nullable().optional(),
        status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED']).optional(),
      },
    },
    async (args) => run(() => request('/api/projects', { method: 'POST', body: args })),
  )

  server.registerTool(
    'search_documents',
    {
      description: 'Full-text search the shared Files library; returns matching documents with snippets.',
      inputSchema: {
        q: z.string().min(1),
      },
    },
    async ({ q }) => run(() => get(`/api/documents/search${qs({ q })}`)),
  )
}
