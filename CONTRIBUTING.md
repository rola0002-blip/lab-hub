# Contributing to LabHub

Thanks for your interest! LabHub is a self-hosted research-lab platform —
equipment booking, team chat, project tracking, and files — run by each lab
for its own members.

## Development setup

Requirements: Node 22+, Docker, Docker Compose v2.

```
docker compose up -d db     # local Postgres on 127.0.0.1:5432
npm install
cp .env.example .env        # then edit for local dev
npm run dev
```

The setup wizard runs on first launch (organisation name, first admin).

## Before you open a PR

All of these must pass — CI runs them on every PR:

```
npm run lint        # eslint
npm run contrast    # WCAG contrast gate over the design tokens
npm run coverage    # unit + integration, ≥85% lines/functions, ≥80% branches
npm run test:e2e    # Playwright journeys incl. axe-core a11y sweep
```

Integration tests and e2e need the local Postgres from the compose file
(see `vitest.integration.config.ts` / `playwright.config.ts`; override with
`TEST_DATABASE_URL`).

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `ci:`, `build:`.
- Database migrations are hand-written and additive-only (`prisma migrate deploy` only).
- UI uses the semantic design tokens in `src/app/globals.css` — never hardcode colours.
- Accessibility is a release gate, not a nicety (F6 landmarks, keyboard paths, both themes).

## Reporting bugs / ideas

Open an issue with your LabHub version (Settings → About) and the browser you
use. Labs running their own server: include the section of
`docker compose logs app` around the problem, with any secrets redacted.
