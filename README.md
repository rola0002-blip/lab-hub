# LabHub

Self-hosted lab management for research groups: equipment booking with
certification gating and approvals, Slack-style team chat, project tracking,
and a shared file library — one Docker install per lab, no cloud dependency.

Your data stays on hardware your lab controls. Members use it from any
browser (desktop or phone), install it as a PWA, or as a native desktop app.

## Quick install (any lab)

A machine that stays on (a lab server, an old laptop, a mini-PC) with
[Docker](https://docs.docker.com/get-docker/) installed:

```
curl -fsSL https://raw.githubusercontent.com/rola0002-blip/lab-hub/main/install.sh | sh
```

The installer creates `~/labhub`, generates secrets, starts the stack, and
prints a one-time `SETUP_TOKEN`. Open the printed URL, enter the token in the
setup wizard, name your lab, create the first admin, and invite people from
the People page. Plain HTTP works on your LAN; add a Cloudflare Tunnel token
during install for public HTTPS (activates web push + PWA install).

Day-to-day: `~/labhub/labhub {update|backup|down|logs|status}`.
Details and options: [docs/ops/distribution.md](docs/ops/distribution.md).

Prefer git? Classic clone install: `cp .env.example .env`, then
`docker compose --profile prod up -d --build` — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Desktop app

LabHub also ships as a native desktop app for macOS and Windows — download
the latest `.dmg` / `-setup.exe` from
[GitHub Releases](https://github.com/rola0002-blip/lab-hub/releases/latest),
open it, and add your lab's URL. Sign in once per lab; the app remembers
each workspace side by side (like a Slack workspace switcher), shows unread
badges on the dock icon and sidebar, and sends sounded native notifications
for every unmuted message (plus a dock bounce when you're not looking). It
checks for updates automatically; installing one is
a click in the tray menu.

- **macOS 14+**: first launch of an unsigned app — after dragging it to
  /Applications, run
  `xattr -d com.apple.quarantine /Applications/LabHub.app` in Terminal, or
  try to open it once and approve it under System Settings → Privacy &
  Security → Open Anyway. (The old right-click → Open bypass no longer works
  on current macOS.) The first notification asks for permission once.
- **Windows 10/11**: run the installer; SmartScreen may warn on first run —
  "More info" → "Run anyway". WebView2 installs itself if missing.
- The desktop app is a thin shell over the same web app your lab server
  already serves — no extra server setup.

Details: [docs/desktop.md](docs/desktop.md).

## Mobile app (PWA)

LabHub installs on phones as a progressive web app — a home-screen icon,
fullscreen, with push notifications for every unmuted message once you've
been idle for two minutes (a direct @mention still pierces mute). The server must be
reachable over HTTPS (service workers and push require a secure context); the
Cloudflare Tunnel option above provides it.

- **iPhone/iPad (iOS 16.4+)**: open the site in Safari → **Share** →
  **Add to Home Screen** → launch LabHub from the icon (notifications only
  work when it is launched from the home screen, not from a Safari tab) →
  open the bell and enable notifications. In-app help: the bell tray's
  "Install app" row walks you through it.
- **Android**: open the site in Chrome → menu → **Install app** (or the
  install banner; the bell tray's "Install app" row triggers it too) → open
  the bell and enable notifications. Unread chats also show as a badge on
  the launcher icon.
- iOS may evict the storage of a home-screen web app that hasn't been used
  for ~7 days; if notifications stop, open LabHub once and re-enable them
  from the bell.

Members who complete the bell's **Set up notifications** wizard (install,
permission, test ping) receive sounded push for every unmuted message
whenever they are idle or away — the same Slack-like behavior as the
desktop app.

## What's inside

- **Equipment booking** — per-instrument policies, certification gating,
  approval queues, recurring bookings, maintenance windows, iCal sync.
- **Team chat** — channels, DMs, threads, @mentions, reactions, attachments,
  full-text search, realtime over SSE, web push, Slack import.
- **Projects** — issue tracker (`LAB-n`), keyboard-accessible board,
  milestones, labels, weekly update prompts, LabHub Bot digests.
- **Files** — shared document library with 100 MB uploads and search.
- **RA acknowledgments** — members and guests record reading a risk
  assessment from Files' "RA" folder; admins review records and export CSV.
  A wrongly-added acknowledgement can be revoked (your own rows; any row for
  admins) and re-acknowledged afterwards.
- **Platform** — roles (admin/member/guest), invitations, light/dark + 10
  accents, ⌘K palette, WCAG-checked accessibility.

Feature deep-dives: [docs/features.md](docs/features.md).

## Operations

Backups, restores, upgrades: [docs/ops/distribution.md](docs/ops/distribution.md)
and [docs/ops/ops-card.md](docs/ops/ops-card.md).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) — local dev needs Node 22 + Docker;
CI gates are lint, WCAG contrast, ≥85% coverage, and Playwright e2e incl.
an axe-core accessibility sweep.

## License

[MIT](LICENSE) — run it, fork it, cite it.
