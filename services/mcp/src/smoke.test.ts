import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, 'index.ts')
const tsxCli = path.join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')

const EXPECTED_TOOLS = [
  'cancel_booking',
  'create_booking',
  'create_issue',
  'create_project',
  'dm_user',
  'get_availability',
  'get_issue',
  'health',
  'list_conversations',
  'list_equipment',
  'list_issues',
  'list_projects',
  'list_users',
  'preview_booking',
  'read_messages',
  'search_chat',
  'search_documents',
  'send_message',
  'update_issue',
  'whoami',
]

describe('labhub-mcp stdio smoke', () => {
  it('initializes over stdio and lists all 20 tools', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [tsxCli, entry],
      env: { ...process.env, LABHUB_API_KEY: 'smoke-test-key' },
    })
    const client = new Client({ name: 'smoke', version: '0.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS)
    expect(tools.every((t) => (t.description ?? '').length > 0)).toBe(true)
    await client.close()
  })

  it('exits(1) with a stderr message when LABHUB_API_KEY is missing', async () => {
    const child = spawn(process.execPath, [tsxCli, entry], { env: { PATH: process.env.PATH } })
    const [code, stderr] = await new Promise<[number | null, string]>((resolve) => {
      let err = ''
      child.stderr.on('data', (d) => {
        err += d
      })
      child.on('close', (c) => resolve([c, err]))
    })
    expect(code).toBe(1)
    expect(stderr).toContain('LABHUB_API_KEY')
  })
})
