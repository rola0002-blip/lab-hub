import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.js'

if (!process.env.LABHUB_API_KEY) {
  console.error('labhub-mcp: LABHUB_API_KEY is not set — mint one with `npm run mint-service-key` in the LabHub repo and export it.')
  process.exit(1)
}

const server = new McpServer({ name: 'labhub-mcp', version: '0.1.0' })
registerTools(server)

await server.connect(new StdioServerTransport())
