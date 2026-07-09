# Slack → LabHub cutover runbook

This is the operator procedure for migrating a lab off Slack and onto LabHub
messaging. The importer (`npm run import:slack`) is **idempotent** (re-running
the same export inserts nothing new) and **additive** (it only writes Slack rows,
tagged with `slackChannelId` / `slackTs` markers, and never mutates existing
LabHub conversations, messages, or users). That is what makes the rollback in
step 6 safe.

Read the pre-flight section first — two of its checks (export tier, lowercase
emails) decide whether the import will match users and pull private channels at
all, and they are cheaper to confirm before the freeze than to discover after.

---

## Pre-flight (do this before announcing a freeze)

**1. Confirm what your Slack export tier actually contains.** The importer reads
**only** `users.json` and `channels.json` at the export root, and takes channel
membership from each channel's `members[]` array.

- **Public channels** are always in `channels.json` — these always import.
- **Private channels** import **only if your export tier writes them into
  `channels.json` with a populated `members[]`.** Some tiers place private
  channels in a separate `groups.json` (which the importer does **not** read),
  and some tiers omit private channels entirely. Standard/free-tier exports
  typically include public channels only. Open the export and confirm your
  private channels appear in `channels.json` before relying on them.
- **Direct messages and group DMs do NOT import.** They live in `dms.json` /
  `mpims.json` (and per-DM folders), none of which the importer reads. State
  this plainly to your users: 1:1 and group DM history stays in Slack.

**2. Spot-check that LabHub user emails are stored lowercase.** The importer
matches a Slack user to an existing LabHub account by **exact match on the
lowercased Slack email** (`prisma.user.findUnique` on `email.toLowerCase()`).
LabHub already stores emails lowercased, but confirm on your instance:

```sql
SELECT email FROM "user" WHERE email <> lower(email);
```

Expect **0 rows**. Any row here is an account whose Slack messages will not
match and will instead land under a banned placeholder user — fix the casing
before importing.

**3. Know how unmatched authors are handled.** Every Slack user referenced by
imported content but not matched to a LabHub account (no email, email mismatch,
or a "ghost" id absent from `users.json`) gets a **banned guest placeholder**
account (`id = slack-import-<slackId>`, `role = guest`, `banned = true`). Their
messages import and render with their Slack display name; they simply cannot log
in. This is expected and keeps history complete.

---

## 1. Freeze

- Announce the cutover date and time to the lab.
- In Slack, set the channels being migrated to **read-only** (or post a pinned
  "moving to LabHub — do not post here" notice) so no new messages are written
  after you take the export. Any message posted in Slack after the export
  snapshot will not be in LabHub.

## 2. Export

- In Slack: **Admin → Settings & administration → Workspace settings →
  Import/Export Data → Export → Start Export**.
- Choose the date range (usually "entire history").
- Download the export **ZIP** when Slack emails you the link.

## 3. Import

Run the importer against the ZIP (an already-extracted directory also works):

```bash
npm run import:slack -- /path/to/slack-export.zip
```

In production, run the importer from a host checkout of this repo — **not** inside
the `app` container. The runtime image is built with `npm ci --omit=dev`, so it has
no `tsx` (the importer's runner is a devDependency), and the standalone output ships
neither the root `package.json` scripts nor the TypeScript `src/` tree; the `app`
service also has no source bind-mount. Instead, on the host, check out this repo,
install dev dependencies, and point `DATABASE_URL` at the production database — the
compose `db` service publishes it on `localhost:5432`:

```bash
npm ci   # installs dev dependencies, including the tsx the importer runs under

# Use the same POSTGRES_PASSWORD you set for the stack (defaults to `labhub`).
DATABASE_URL='postgresql://labhub:<POSTGRES_PASSWORD>@localhost:5432/labhub' \
  npm run import:slack -- /path/to/slack-export.zip
```

The CLI prints a summary like:

```
Slack import complete
────────────────────────────────────
users matched              12
placeholders created       3
channels                   8
plan messages (total)      4213
messages inserted          4213
messages skipped (dupes)   0
messages dropped           0
reactions                  1874
────────────────────────────────────
reconcile  4213 + 0 + 0 = 4213 (plan 4213)
planTotal reconciles ✓
```

**Compare the printed counts to the export:**

- `channels` should equal the number of channels in `channels.json` that you
  expected to migrate.
- `plan messages (total)` is the number of importable messages the transform
  produced from the export (see the fidelity notes below for what is and isn't
  counted).
- On a **first** run, `messages inserted` should equal `plan messages (total)`,
  and `messages skipped (dupes)` should be `0`. On a **re-run** of the same
  export, `inserted` is `0` and `skipped` equals the plan total — that is the
  idempotency guarantee, not an error.

## 4. Verify

**Reconciliation (required).** The last two lines must read:

```
reconcile  <inserted> + <skipped> + <dropped> = <total> (plan <total>)
planTotal reconciles ✓
```

- The line **must reconcile** (`inserted + skipped + dropped = plan total`) — if
  it prints `planTotal MISMATCH ✗`, stop and investigate; do not announce the
  switch.
- **`messages dropped` must be `0`.** `dropped` counts plan messages whose
  channel or author could not be resolved at apply time. With ghost authors
  rostered as placeholders this is `0` in a normal run; any non-zero value means
  content silently did not import — treat it as a failed import and roll back.

**Spot-check the UI.** Sign in as a member who belonged to the migrated channels
and confirm:

- Open **3 channels** — messages render in order with correct authors and
  timestamps.
- Open a **thread** — replies are nested under their parent (thread linkage
  survives the import).
- Run **search** for a distinctive phrase from an old Slack message — the
  imported message is found. (Search only returns conversations the signed-in
  user is a member of, so use an account that was a channel member.)

### Fidelity — what imports faithfully, and what is transformed or dropped

Set expectations with your users up front:

- **Reactions:** only these 8 emoji names map to LabHub reactions —
  `+1 heart joy tada white_check_mark eyes fire pray`. Skin-tone variants
  (e.g. `+1::skin-tone-3`) and custom/workspace emoji are **dropped**. Message
  text is unaffected.
- **`@mentions`** of the form `<@U123>` / `<@U123|label>` are rewritten to plain
  `@Display Name` text (no live LabHub mention token or notification is minted).
- **Other Slack markup passes through as literal text** — channel links
  (`<#C123|general>`), auto-linked URLs (`<https://…|label>`), and special
  mentions (`<!here>`, `<!channel>`) appear verbatim in the message body. They
  are not rendered as links or mentions.
- **`thread_broadcast`** (a threaded reply also sent to the channel) and
  **`file_share`** (older file-post messages) **ARE imported**, preserving
  thread linkage and file references.
- **File attachments** import as a text line (`📎 <name>: <url_private>`); the
  file bytes themselves are not copied from Slack, so those private URLs require
  Slack access to open. The message and its context are preserved.
- **Every other message subtype is skipped by design** — channel join/leave
  notices, bot messages, and similar system chatter do not import.
- Messages that are empty **and** have no files are skipped.

## 5. Announce the switch

- Tell the lab that LabHub is now the source of truth for messaging.
- Include **Web Push opt-in** instructions: after the admin has set
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in `.env` and restarted, each person
  enables notifications from the chat UI in their browser (and installs the PWA
  on iOS to receive push there). Push fires for mentions and DMs only when the
  recipient has no live tab open, and per-conversation mute silences it (except
  direct @mentions).
- Keep the Slack workspace readable (not deleted) for a grace period so people
  can reach DM history, which did not migrate.

## 6. Rollback

LabHub messaging is **additive**: every imported row carries a marker
(`Conversation.slackChannelId` and `Message.slackTs` are non-null only on
imported rows). If an import is wrong, delete exactly those rows, fix the cause,
and re-run — no LabHub-native data is affected.

> **Run rollback before anyone posts natively into the imported channels.** The
> message-level delete is surgical (only `slackTs`-marked rows). The
> conversation-level delete **cascades** — it removes the channel and everything
> in it, including its `ConversationMember` rows and any native messages posted
> after the import. If the lab has already started using an imported channel,
> use only the first statement.

Delete imported messages, then imported conversations:

```sql
-- 1. Imported messages. Cascades to their reactions and attachments
--    (Reaction.messageId / ChatAttachment.messageId are ON DELETE CASCADE).
DELETE FROM "Message" WHERE "slackTs" IS NOT NULL;

-- 2. Imported conversations. Cascades to their ConversationMember rows
--    (and to any messages still in them, also ON DELETE CASCADE).
DELETE FROM "Conversation" WHERE "slackChannelId" IS NOT NULL;
```

Optionally remove the banned placeholder accounts the import created (safe only
**after** step 1, because `Message.userId` is `ON DELETE RESTRICT` — imported
messages must be gone first):

```sql
DELETE FROM "user" WHERE id LIKE 'slack-import-%';
```

Run these against the app database:

```bash
docker compose exec db psql -U labhub labhub
```

Then fix the underlying issue (e.g. correct a mis-cased LabHub email from the
pre-flight check, or re-export with a tier that includes private channels) and
re-run `npm run import:slack -- <export.zip>` from step 3.
