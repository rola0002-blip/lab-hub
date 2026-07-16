# COLOSSUS — Mac Studio (Colima) Internet-Facing Server: Provisioning Runbook

COLOSSUS runs on a Mac Studio under **Colima Docker**, fronted by the **Cloudflare Tunnel**
(`cloudflared`) over **HTTPS** at `https://colossus.<domain>`. The tunnel dials **outbound**
to Cloudflare, so the host publishes **no inbound port** — no firewall change, no port-forward,
no stable inbound LAN address; only reliable outbound internet from the host is required. This
supersedes the Windows-laptop LAN / plain-HTTP beta (`windows-server.md`, now legacy).

## 1. Domain
Register a domain via **Cloudflare Registrar** (~S$15-20/yr), or add/select an existing zone.

## 2. Cloudflare account
Create the free Cloudflare account; add the domain (or use the existing zone).

## 3. Tunnel
Zero Trust → Networks → Tunnels → **create a tunnel**. Copy the **connector token**
(→ `TUNNEL_TOKEN`). Add a **Public Hostname** `colossus.<domain>` → service `http://app:3000`
(this public-host → app:3000 ingress map lives in the Cloudflare dashboard/token, not the repo).

## 4. Colima + docker CLI
    brew install colima docker docker-compose
    # brew installs the compose plugin BINARY but does NOT register it with the Docker CLI, so
    # `docker compose ...` (first deploy + all four ops scripts + both LaunchAgents) fails with
    # "'compose' is not a docker command" until you wire it in. Symlink it into the CLI plugins
    # dir (or add {"cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins"]} to
    # ~/.docker/config.json):
    mkdir -p ~/.docker/cli-plugins
    ln -sf /opt/homebrew/bin/docker-compose ~/.docker/cli-plugins/docker-compose
    colima start --memory 6 --cpu 4      # record this exact command for the boot wrapper
    docker compose version                # verify the engine AND the compose plugin are wired

## 5. Clone (read-only PAT)
Create a fine-grained GitHub PAT scoped to THIS repo only, permission **Contents: Read** (the
host only ever pulls tags), then `git clone https://<PAT>@github.com/<owner>/<repo>.git <path>`.

## 6. Generate .env
Run `./scripts/macos/init-env.sh`. It mints `BETTER_AUTH_SECRET` + `POSTGRES_PASSWORD` and a
VAPID keypair (**fatal if minting fails** — push is a real deliverable under HTTPS), prompts for
the **https** `APP_URL` and the `TUNNEL_TOKEN`, and sets `AUTH_TRUSTED_IP_HEADER=cf-connecting-ip`,
`AUTH_RATE_LIMIT_MAX=10`, `APP_PORT=3000`. It also mints a one-time **`SETUP_TOKEN`** and
**prints it at the end** — copy it now; you enter it once in the setup wizard (§8).

> **Why `SETUP_TOKEN`.** The tunnel goes live together with the app (§7), and the public hostname
> is discoverable via Certificate-Transparency log scanners within minutes of §3 — potentially
> before you finish setup. Without the gate, anyone who reaches `https://colossus.<domain>` first
> could POST the sign-up / setup endpoints and claim the first admin. With `SETUP_TOKEN` set, the
> wizard (and the bootstrap sign-up path) reject any provisioning attempt that does not present
> the exact token, so only you can create the first admin. It is a one-time provisioning control;
> after setup completes it is unused.

> **APP_URL is exact.** It must equal `https://colossus.<domain>` — scheme + host, https, no
> trailing slash, no path, no port. Every emitted URL, better-auth `baseURL`, Secure-cookie
> enablement, and Origin/CSRF check derives from this string; a mismatch **403s** sign-in POSTs.

## 7. First deploy
**Port-collision preflight (shared Studio).** A fresh clone at a new path is a *new* compose
project, so its `db` (host `${DB_PORT:-5432}`) and app (`${APP_PORT:-3000}`) host-publish ports
must be free — another project already holding 5432 makes `up -d` fail with `bind: address
already in use`. Both must print nothing:

    lsof -nP -iTCP:5432 -sTCP:LISTEN
    lsof -nP -iTCP:3000 -sTCP:LISTEN

If either is occupied, set a free `DB_PORT` and/or `APP_PORT` in `.env` before deploying (the app
still reaches Postgres over the compose network at `db:5432`; `APP_PORT` is only the on-box
health-poll port). Then:

    docker compose --profile prod --profile tunnel up -d --build
The container runs `prisma migrate deploy` against the fresh DB, then boots; `cloudflared` waits
for the app HEALTHCHECK before advertising the origin.

## 8. Setup wizard → invite members
Open `https://colossus.<domain>`, complete the **setup wizard** (creates the org + first admin) —
paste the **`SETUP_TOKEN`** that `init-env.sh` printed in §6 into the wizard's *Setup token* field
(the wizard rejects setup without it while the gate is set) — then on **People** create invites and
use **Copy link** to share accept URLs (SMTP is off).

## 9. Automation + host settings
Install the two LaunchAgents (substitute your clone path), enable automatic login, disable sleep:

    REPO="$HOME/colossus"   # your clone path
    for a in stack backup; do
      sed "s#/ABSOLUTE/PATH/TO/lab-hub#$REPO#g" "scripts/macos/launchd/com.colossus.$a.plist" \
        > "$HOME/Library/LaunchAgents/com.colossus.$a.plist"
      launchctl load "$HOME/Library/LaunchAgents/com.colossus.$a.plist"
    done
    # System Settings → Users & Groups → Automatically log in (the operator account)
    sudo systemsetup -setcomputersleep Never

`com.colossus.stack` (RunAtLoad) starts Colima then the prod+tunnel stack; `com.colossus.backup`
runs `scripts/backup.sh` nightly at 03:00. Both are **LaunchAgents** (Colima's VM + docker context
are user-scoped, so they must run in the logged-in operator session — hence automatic login). To
mirror backups to an external disk, add a `BACKUP_MIRROR_PATH` entry to the backup plist's
`EnvironmentVariables`.

> **The sed line uses a `#` delimiter (not `/`) and quotes both paths on purpose** — the plist
> source path and your clone path may contain characters (including spaces) that would break an
> unquoted or `/`-delimited substitution. Keep it as written.

> **launchd 03:00 timing is not a hard cron.** `com.colossus.backup` uses
> `StartCalendarInterval` (Hour 3, Minute 0). launchd is **not** wall-clock-exact: if the Mac is
> **asleep** at 03:00, launchd coalesces the missed occurrences and fires the job **once on wake**;
> if the Mac is **powered off** at 03:00, that occurrence is **skipped** entirely (there is no
> catch-up on next boot). `sudo systemsetup -setcomputersleep Never` above keeps the machine awake
> so 03:00 lands on time. The 03:00 backup also **presumes the stack is up** — `backup.sh` runs
> `docker compose exec -T db pg_dump`, which fails if the `db` container is not running, so the
> `com.colossus.stack` agent (RunAtLoad) must have brought Colima + the stack up first.

## 10. Release-tag rule
A release tag = `v` + the `package.json` version. Cut releases with `npm run release` only; a
hand-cut tag whose name disagrees makes `update.sh` report FAILED on a healthy stack (the
health-gate compares the tag to `/api/health`'s version).

> **Upgrading an existing pre-SP7 deployment in place?** Older images ran the container as root,
> so the `uploads` volume can hold **uid-0 files** the SP7 non-root app (uid 1000 `node`) cannot
> write or serve. Apply the one-time chown fix from the **Restore** section below (same remedy)
> once, after the first SP7 boot. A brand-new deploy (§7, fresh volume) does not need this — the
> fresh `uploads` volume inherits `node:node` ownership from the image.

## 11. HTTPS advantage + loopback-only posture
The outbound tunnel means no inbound port, no port-forward, and no stable inbound LAN address —
only reliable outbound internet from the host. **The compose file publishes only
`127.0.0.1:${APP_PORT:-3000}:3000` (app) and `127.0.0.1:5432:5432` (db); nothing is bound on
`0.0.0.0`,** so the app and database are unreachable from the LAN or the internet — ingress is
exclusively the outbound cloudflared tunnel, and the loopback binds exist only for the on-box
`/api/health` poll (`update.sh`/`rollback.sh`) and the Mac dev workflow. The internal
cloudflared→app hop is plain HTTP; Secure cookies + absolute URLs stay correct because they
derive from the string `APP_URL=https://…`.

## 12. cloudflared image pin
`docker-compose.yml` pins `cloudflare/cloudflared:<version>` (not `:latest`) for reproducibility.
Recorded pin: **cloudflare/cloudflared:2026.7.2** (derived 2026-07-16 from
`docker run --rm cloudflare/cloudflared:latest --version` at provisioning). Update the pin + this
line when you deliberately upgrade the connector.

## 13. Manual verification checklist

- [ ] `init-env.sh` writes a valid `.env` (secrets minted; VAPID minted **non-blank**; `SETUP_TOKEN` minted **and printed**; `APP_URL=https://colossus.<domain>`; `TUNNEL_TOKEN` set; `AUTH_TRUSTED_IP_HEADER=cf-connecting-ip`; `AUTH_RATE_LIMIT_MAX=10`; `APP_PORT=3000`).
- [ ] First `docker compose --profile prod --profile tunnel up -d --build` reaches the **setup wizard** at `https://colossus.<domain>` (tunnel healthy; TLS valid).
- [ ] **Setup-token gate:** the wizard shows a *Setup token* field and **rejects** a wrong/blank token; setup succeeds only with the `SETUP_TOKEN` printed by `init-env.sh`.
- [ ] **Server Action** end-to-end over the tunnel (e.g. create an invite on People) succeeds — no Origin/Host error. If it errors, add `experimental: { serverActions: { allowedOrigins: ['colossus.<domain>'] } }` to `next.config.ts` and re-verify (§4.4).
- [ ] `update.sh` on the current (no-op) tag: backs up, rebuilds, health-polls to the matching version, reports success.
- [ ] `update.sh` on a deliberately-bad tag: prints the exact `rollback.sh <prev>` + `logs` guidance and exits non-zero.
- [ ] `backup.sh` writes `labhub-<stamp>.sql.gz` (+ `uploads-<stamp>.tar.gz` once uploads exist), honors keep-last-14, and mirrors to `BACKUP_MIRROR_PATH` when set.
- [ ] **Non-ASCII backup round-trip.** Seed a chat message with an emoji and a member whose name uses CJK/accented characters (e.g. 陈 / José); run `backup.sh`; restore that dump per the ops card into a scratch stack; confirm the emoji and name come back **byte-identical** (not mojibake / `?`).
- [ ] `rollback.sh <prev>` returns the app to the prior version with data intact.
- [ ] The two `launchd` agents survive a **reboot**: after power-cycling, `colima` + the stack come up automatically and `https://colossus.<domain>` is reachable; the 03:00 backup agent fires and produces an artifact.
- [ ] **Security headers:** `curl -sI https://colossus.<domain>/` shows HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and the report-only CSP; a document fetch via `/uploads/...` shows `nosniff`.
- [ ] **Lighthouse "Installable" PWA audit** (Chrome DevTools) passes over HTTPS — the previously deferred check, now runnable.
- [ ] **Real phone push test:** on a phone, open `https://colossus.<domain>`, install the PWA, opt into notifications, trigger a notifying event (e.g. a mention/DM), and confirm a **push notification is delivered** — proving VAPID keys reached the container and delivery works.
- [ ] Nothing is reachable off-box on a raw port: from another machine, `curl http://<host-lan-ip>:3000/` and `:5432` both fail to connect (loopback-only binds).

## 14. Accepted-as-is (SP7 §7.3/§11)
- ICS capability-URL feed (`/api/calendar/<token>.ics`): per-user regenerable 32-byte token,
  Google/Outlook-secret-address model; generic 404 on unknown/revoked; `Cache-Control: private`.
- No in-app global API throttle: invitation-gated sign-up + Cloudflare free-tier WAF/rate-limit/
  bot backstop; only the three better-auth endpoints are throttled in-app.
- `/api/health` version disclosure: minimal `{ ok, version }`; a Cloudflare access rule can gate
  it later.
- Report-only CSP this wave; enforcement (nonce/hash + report sink → enforcing CSP, drop
  X-Frame-Options for frame-ancestors) is a documented follow-up.

## Restore (catastrophe only)
Version rollbacks are data-safe (additive-only migrations). A DB restore is only for data
catastrophe. Dumps are self-cleaning (`pg_dump --clean --if-exists`) — pipe straight in:

    docker compose --profile prod --profile tunnel stop app
    gunzip -c backups/labhub-<stamp>.sql.gz | docker compose exec -T db psql -U labhub labhub
    # (uploads, if needed) tar back into the volume. The archive's top-level entry is the
    # stamped dir `uploads-<stamp>/`, so copy from that path (NOT /tmp/uploads/):
    #   tar -xzf backups/uploads-<stamp>.tar.gz -C /tmp && docker compose cp /tmp/uploads-<stamp>/. app:/data/uploads
    # `docker compose cp` writes into the volume as uid 0, so the non-root app (uid 1000 `node`)
    # then cannot write/serve those files. Fix ownership once (adapt the volume name — it is
    # `<compose-project>_uploads`, e.g. `colossus_uploads` when cloned to `$HOME/colossus`; run
    # `docker volume ls | grep uploads` to confirm the exact name):
    #   docker run --rm -u 0 -v colossus_uploads:/data/uploads busybox chown -R 1000:1000 /data/uploads
    docker compose --profile prod --profile tunnel up -d app
