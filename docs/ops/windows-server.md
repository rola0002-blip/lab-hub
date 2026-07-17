# LabHub — Windows Laptop Server (LAN beta) Provisioning Runbook

> **LEGACY (superseded).** The Windows-laptop LAN / plain-HTTP beta is retired. Current
> deployment is the macOS/Colima Cloudflare-tunnel server — see `docs/ops/macos-server.md`.
> This document is kept for the SP6 restore knowledge only — the paths and hostnames below
> (`C:\colossus`, `colossus-lab`) are left exactly as the Windows laptop was actually built,
> so a recovery matches what is on the disk.

The beta runs LabHub on an unused Windows laptop as an always-on server on the NTU
LAN, reachable over **plain HTTP** at `http://<host>/`. Updates are pulled from a
**private** GitHub repo and applied with `scripts\windows\update.ps1`. On plain HTTP,
PWA install + Web Push stay **dormant** (no errors, no dead affordances); the in-app
bell + SSE keep working. HTTPS (a future Cloudflare tunnel) un-dorms both with no code
change.

## 1. Install prerequisites
- **Docker Desktop** with the **WSL2** backend enabled (Settings → General → "Use the WSL 2 based engine").
- **Git for Windows** (provides `git` + a Bash-free PowerShell workflow).

## 2. Clone the private repo (read-only PAT)
Create a **fine-grained** GitHub Personal Access Token scoped to **this repository only**,
permission **Contents: Read** (read-only is enough — the laptop only ever pulls tags):
```powershell
git clone https://<PAT>@github.com/<owner>/<repo>.git C:\colossus
cd C:\colossus
```
(Or use Git Credential Manager and clone over HTTPS.)

## 3. Generate `.env`
```powershell
.\scripts\windows\init-env.ps1                 # prompts for APP_URL; mints secrets; APP_PORT defaults to 80
```
Set `APP_URL` to the LAN address members will use (e.g. `http://colossus-lab/`). SMTP is
left blank on purpose (see step 8 — invitations use copyable links).

> **`APP_URL` must agree with `APP_PORT`.** `init-env.ps1` defaults `APP_PORT=80`, so
> `APP_URL` must have **no port suffix** — `http://colossus-lab/`, never
> `http://colossus-lab:3000/`. Every ICS feed, invitation accept-URL, and email link is
> built from `APP_URL`; a port that disagrees with the mapped `APP_PORT` sends members to
> a dead address. If you deliberately choose a non-80 `APP_PORT`, put that **same** port
> in `APP_URL` (e.g. `APP_PORT=8080` → `APP_URL=http://colossus-lab:8080/`).

> **`AUTH_RATE_LIMIT_MAX` — the sign-in/up throttle is lab-wide here.** better-auth rate
> limits per client IP, but the directly-published Docker port (§4) SNATs **every** LAN
> browser to one Docker-gateway source IP, so the whole lab shares **one** sign-in bucket
> and one sign-up bucket. At the code default of `10`/60 s that means an onboarding burst
> (≥11 invitees accepting within a minute) — or a single user mistyping their password 10
> times — returns HTTP 429 "Too many requests" **for everyone** for the rest of the window,
> reading like an outage. `init-env.ps1` therefore writes `AUTH_RATE_LIMIT_MAX=100` for the
> LAN beta. Tune it to lab size if needed; do **not** set it blank (that fails validation)
> and do **not** remove it to "disable" limiting — the limiter stays on by design. Per-IP
> identity buys almost nothing behind the published port, and invitation-only sign-up keeps
> the surface bounded, so a higher ceiling on a trusted LAN is the right trade.

## 4. Clean port-80 mapping
`docker-compose.yml` maps `'${APP_PORT:-3000}:3000'`; `init-env.ps1` writes `APP_PORT=80`
so members hit `http://<host>/` with no `:3000`. First check nothing else holds port 80:
```powershell
netstat -ano | findstr :80
```
If IIS / "World Wide Web Publishing Service" / any `http.sys` consumer is listening, stop
and disable it, or set a different `APP_PORT` in `.env`.

## 5. Power settings (never sleep on AC; lid-close does nothing)
```powershell
powercfg /change standby-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
```
Also disable Fast Startup if it interferes with auto-restart after a power event.

## 6. Auto-start + restart policy
- Docker Desktop → Settings → General → **Start Docker Desktop when you log in**, and
  keep **containers start on launch**.
- The compose stack already sets `restart: unless-stopped` on **app**, **cloudflared**,
  and **db** (added in SP6), so the whole stack survives a reboot.

## 7. Stable LAN address
Give the laptop a **DHCP reservation** (or a static IP) and a memorable **hostname**, so
`APP_URL` and member bookmarks stay valid across reboots. Prefer a wired connection; the
address must be reachable by lab members' machines on the NTU LAN.

## 8. First deploy → setup wizard → invite members
```powershell
docker compose --profile prod up -d --build
```
The container applies all migrations at start (`prisma migrate deploy`) against the fresh,
empty DB, then boots. Open `http://<host>/`, complete the **setup wizard** (creates the org
+ first admin), then **invite members**: on **People**, create an invite and use **Copy
link** to share the accept URL directly (SMTP is off, so invitation emails only queue).
Resending an invite mints a new link and invalidates the old one.

## 9. Nightly backups (Task Scheduler, 03:00)
Create a Task Scheduler job:
- **Trigger:** daily at **03:00**.
- **Action:** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\colossus\scripts\windows\backup.ps1`
- **Start in:** `C:\colossus`
- **Settings:** "Run whether user is logged on or not", "Run with highest privileges".
Backups land in `.\backups\` (gitignored), keep the last **14** of each class, and — if
`ONEDRIVE_BACKUP_PATH` is set (env or `-OneDriveBackupPath`) — mirror to a OneDrive folder.

**Caveat:** Docker Desktop runs in the interactive user session, so the server account must
stay **logged in** (per the §6 auto-start setup — lock the screen, don't sign out) or the
03:00 job cannot reach the Docker engine and `backup.ps1` fails at `pg_dump`.

## 10. Health monitoring
`http://<host>/api/health` returns `{ ok, version }` — the quick "is it up and on the right
version" check (also what `update.ps1` polls after a patch).

## 11. Adding HTTPS later (pointer, not a beta step)
The `tunnel` compose profile (`cloudflared`) fronts the app over HTTPS. Switching it on is
the future path that un-dorms PWA install + Web Push (no code change). It is **not** part of
the beta.

## 12. Keeping LabHub updated (day-2)
Deploy a new release with `scripts\windows\update.ps1` (the operator card at
`docs/ops/ops-card.md` has the exact one-liners). It backs up first, checks out the target
tag (newest `v*` by default, or `-Tag vX.Y.Z`), rebuilds the prod stack — the container
re-runs `prisma migrate deploy` at start — then polls `GET /api/health` until the served
`version` equals the tag, and prints the precise `rollback.ps1` + `logs` commands on any
failure.

> **A release tag must equal `v` + the `package.json` version.** `update.ps1`'s health-gate
> compares the tag (with its leading `v` stripped) against the `version` that `/api/health`
> reports — which is `package.json`'s `version`, baked into the image at build time. Cutting
> releases with `npm run release` keeps the two in lockstep by construction. A **hand-cut**
> tag whose name disagrees with `package.json` (e.g. tagging `v0.9.1` on a build that still
> reports `0.9.0-beta`) makes `update.ps1` report **UPDATE FAILED** and hand you a rollback
> command even though the stack deployed cleanly and is healthy. Always tag via
> `npm run release`, never by hand.

---

## Manual Laptop Verification Checklist
Run once during provisioning and after any script change (there is no Windows CI):

- [ ] `init-env.ps1` writes a valid `.env` (secrets minted; `APP_URL` set; `APP_PORT=80`; SMTP blank).
- [ ] First `docker compose --profile prod up -d --build` reaches the **setup wizard** at `http://<host>/`.
- [ ] `update.ps1` on the current (no-op) tag: backs up, rebuilds, health-polls to the matching version, reports SUCCESS.
- [ ] `update.ps1` on a deliberately-bad tag: prints the exact `rollback.ps1 -Tag <prev>` + `logs` guidance and exits non-zero.
- [ ] `backup.ps1` writes `labhub-<stamp>.sql.zip` (+ `uploads-<stamp>.zip` once uploads exist), honors keep-last-14, and mirrors to OneDrive when configured.
- [ ] **Non-ASCII backup round-trip (encoding safety).** Seed a chat message with an emoji (and/or a member whose name uses CJK/accented characters, e.g. 陈 / José), run `backup.ps1`, then restore that dump per the operator card (`docs/ops/ops-card.md`) into a scratch/test stack and confirm the emoji and name come back **byte-identical** — not mojibake or `?`. The ASCII-only checks above cannot see a code-page-decode corruption; this is the row that does.
- [ ] The Task Scheduler 03:00 job fires and produces an artifact.
- [ ] `rollback.ps1 -Tag <prev>` returns the app to the prior version with data intact.
- [ ] Members reach `http://<host>/` cleanly (no `:3000`); the stack auto-restarts after a reboot.
- [ ] On plain HTTP: no PWA install prompt and no service-worker registration (dormant, no console errors); the in-app bell still updates.
- [ ] **(Post-HTTPS only — not a beta gate, spec §5.3/§9)** After an HTTPS ingress (the Cloudflare tunnel, §11) is enabled, run a Chrome DevTools **Lighthouse "Installable" PWA audit** to confirm the manifest installs cleanly. This is the deferred PWA check — not runnable or meaningful over plain HTTP.
