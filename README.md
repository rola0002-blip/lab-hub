# LabHub

Self-hosted lab management for research groups: equipment booking with
certification gating and approvals, Slack-style team chat, project tracking,
and a shared file library — one Docker install per lab, no cloud dependency.

Your data stays on hardware your lab controls. Members use it from any
browser (desktop or phone), install it as a PWA, or — coming soon — as a
native desktop app.

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

## What's inside

- **Equipment booking** — per-instrument policies, certification gating,
  approval queues, recurring bookings, maintenance windows, iCal sync.
- **Team chat** — channels, DMs, threads, @mentions, reactions, attachments,
  full-text search, realtime over SSE, web push, Slack import.
- **Projects** — issue tracker (`LAB-n`), keyboard-accessible board,
  milestones, labels, weekly update prompts, LabHub Bot digests.
- **Files** — shared document library with 100 MB uploads and search.
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
