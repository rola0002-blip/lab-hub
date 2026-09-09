# labhub-mcp

Standalone [MCP](https://modelcontextprotocol.io) server exposing the LabHub REST API as
tools over stdio. Version-locked to the LabHub app in this repo; acts as the LabHub Bot
via a service API key.

## Configuration

| Env var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LABHUB_API_KEY` | yes | — | Service key minted via `npm run mint-service-key` (repo root). Server exits(1) without it. |
| `LABHUB_URL` | no | `http://localhost:3000` | Base URL of the LabHub instance. |

## Run

```sh
cd services/mcp
npm install
LABHUB_API_KEY=labhub_… npm start   # stdio transport on stdin/stdout
npm test                            # unit (mocked fetch) + stdio smoke tests
```

## Tools (20)

| Tool | LabHub endpoint | Does |
| --- | --- | --- |
| `health` | `GET /api/health` | Liveness + version (no auth) |
| `whoami` | `GET /api/me` | Verify the service key |
| `list_users` | `GET /api/chat/users` | Members for mentions/DMs/assignment (bot hidden unless `includeBot`) |
| `list_conversations` | `GET /api/chat/conversations` | Channels + DMs |
| `read_messages` | `GET /api/chat/conversations/{id}/messages` | Read a conversation (`take`, `before` cursor) |
| `send_message` | `POST /api/chat/messages` | Send text; `<@userId>`/`<!channel>` mentions; `parentId` threads |
| `dm_user` | `POST /api/chat/conversations/dm` + messages | DM a user, returns `{conversationId, messageId}` |
| `search_chat` | `GET /api/chat/search` | Message search (`q`, optional `conversationId`) |
| `list_equipment` | `GET /api/equipment` | Bookable equipment + policies |
| `get_availability` | `GET /api/bookings` | Existing bookings in a window (default next 7 days) |
| `preview_booking` | `POST /api/bookings/preview` | Dry-run a booking |
| `create_booking` | `POST /api/bookings` | Single or weekly-recurring booking |
| `cancel_booking` | `DELETE /api/bookings/{id}` | Cancel a bot booking |
| `list_issues` | `GET /api/issues` | Filter by status/priority/assignee/project/label |
| `get_issue` | `GET /api/issues/{id}` | One issue in full |
| `create_issue` | `POST /api/issues` | Title required, rest optional |
| `update_issue` | `PATCH /api/issues/{id}` | Partial update; `null` clears nullable fields |
| `list_projects` | `GET /api/projects` | Projects |
| `create_project` | `POST /api/projects` | Name required; lead/dates/status optional |
| `search_documents` | `GET /api/documents/search` | Files-library search |

Errors: non-2xx responses surface as tool errors carrying the HTTP status and LabHub's
`{error}` machine code; network failures and 15s timeouts are named as such. Large
payloads are truncated at ~50KB.

## opencode launch

Register in `~/.config/opencode/opencode.jsonc` (key kept out of the config via the
file secret — the referenced file contains only the key):

```jsonc
{
  "mcp": {
    "labhub": {
      "type": "local",
      "command": ["node", "<repo>/node_modules/tsx/dist/cli.mjs", "<repo>/services/mcp/src/index.ts"],
      "enabled": true,
      "environment": {
        "LABHUB_URL": "http://localhost:3000",
        "LABHUB_API_KEY": "{file:~/.config/labhub/service-key}"
      }
    }
  }
}
```
