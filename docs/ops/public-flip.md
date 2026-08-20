# Going public — checklist (SP10 gate)

Audit-driven procedure for flipping rola0002-blip/lab-hub to public.

## Audit result (completed 2026-08-20, gitleaks 8.30.1)

- gitleaks full-history scan: CLEAN after triage — 2 findings, both the known-safe
  e2e placeholder `e2e-secret-…` (playwright.config.ts and a plan doc quoting it);
  fingerprints in .gitleaksignore
- gitleaks worktree scan: CLEAN after triage — 30 findings: 4 known-safe e2e-placeholder
  hits (tracked files + .next copies), 26 local-only gitignored artifacts (real dev
  secrets in .env/.next/standalone/.env plus derived Next.js build keys under .next/);
  fingerprints in .gitleaksignore
- Real-secret findings: NONE in git history or tracked files. Real secrets exist only
  in the local gitignored `.env` and its `.next/standalone/.env` build copy — verified
  never committed, excluded by `.gitignore` (`.env*`, `/.next/`) and by `.dockerignore`,
  so they cannot reach the public repo or published images
- `.env` never committed: verified: git log --all -- .env empty
- docs/ops personal-detail review: PENDING — manual step below
- Notes: the bulk of worktree findings were `next build` artifacts under .next/
  (preview-mode/RSC encryption keys derived from the dev env). Fingerprints are
  line-numbered canaries: if a local file shifts and a secret reappears on a new
  line, the scan exits 1 again — re-triage, don't blindly extend the ignore list.

## Personal-detail sweep (manual, before flipping)

- [ ] `docs/ops/*.md` reviewed for hostnames, IPs, room numbers, personal
      laptop details you do not want public (edit or generalize).
- [ ] `git log --format='%ae %ce' | sort -u` committer emails reviewed —
      confirm they are the ones you intend to publish.

## Flip

- [ ] GitHub → repo → Settings → General → Danger Zone → Change visibility →
      Public.
- [ ] GHCR package visibility: Packages → lab-hub → Package settings →
      public (images must pull anonymously).

## Post-flip verification (logged-out state)

- [ ] Anonymous clone works: `git clone https://github.com/rola0002-blip/lab-hub`
- [ ] `docker pull ghcr.io/rola0002-blip/lab-hub:vX.Y.Z` works logged out.
- [ ] The install one-liner works from a clean machine (the
      installer-smoke workflow green is sufficient evidence).

## Fallback: orphan history

If the audit finds real secrets in history: `git checkout --orphan
main-public && git add -A && git commit -m "feat: LabHub"`, push that branch,
make it the default branch, delete the old public-facing history, then flip.
The private repo remains the full-history archive.
