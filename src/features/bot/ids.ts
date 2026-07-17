// Fixed ids for the LabHub Bot's single isSystem=true account and the seeded
// #lab-updates channel, kept in a PURE module (no `server-only`, no prisma) so the
// seed migration (prisma/migrations/20260713000000_sp5_calendar_bot_policy), the
// server bot module, and the Playwright e2e runner all agree on the same strings.
// The e2e helpers import these directly — importing the full bot module would pull
// `server-only` into Playwright's Node runner and throw.
export const COLOSSUS_BOT_ID = 'colossus-bot'
export const LAB_UPDATES_CHANNEL_ID = 'colossus-lab-updates'
