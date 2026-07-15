// Single source of truth for the running app version, read from package.json at
// BUILD time (the bundler inlines the JSON import). Surfaced identically in the
// Settings About block, the sidebar footer, and GET /api/health. NOT `server-only`:
// it holds no secret and is imported by a unit test + server modules alike. It is
// threaded to the client Sidebar as a PROP — never imported into a client bundle
// (which would inline package.json).
import pkg from '../../package.json'

export const APP_VERSION: string = pkg.version
