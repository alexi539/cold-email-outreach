# Cold Email Outreach — Project Context & Specification

> **Purpose:** This document is the single source of truth for the Cold Email Outreach application. When modifying or extending the project, read this file first to understand the full picture: what exists, what's planned, and why decisions were made.

---

## 1. Project Overview

### What is this?

A **single-user web application** for cold email outreach. It allows the user to:

- Manage multiple email accounts (Gmail and Zoho, including custom domains)
- Create campaigns with email sequences (initial + follow-ups)
- Upload leads via CSV with dynamic column-based personalization
- Send emails with configurable limits, throttling (per account), and working hours
- Track sent emails and detect replies automatically (human, bounce, auto-reply)
- View all replies with full text in a dedicated **Replies** tab
- Follow-ups sent as replies in the same thread (In-Reply-To / References)

### Target user

One person running cold outreach for sales or marketing. ~15 email accounts, ~2–3k leads per campaign.

### Language

- **UI:** English
- **Emails:** English (user writes templates in English)

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript (Vite) |
| Backend | Node.js (Express) |
| Database | SQLite |
| ORM | Prisma |
| Scheduler | setInterval (send every 10 sec) + node-cron (reply check every 3 min) |
| Email (Google) | Gmail API + OAuth2 |
| Email (Zoho) | SMTP + IMAP (nodemailer) |

---

## 3. Quick Start

```bash
# Install dependencies
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Setup
cp backend/.env.example backend/.env
# Edit backend/.env with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY

# Database
npm run db:push

# Run (backend + frontend)
npm run dev
```

- Frontend: http://localhost:5173 (fixed port — required for Google OAuth redirect)
- Backend: http://localhost:3001

**Production:** If frontend and backend are on different origins, set `VITE_API_URL` (e.g. `https://api.example.com`) in the frontend build environment. Default: `/api` (relative).

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project, enable Gmail API
3. Create OAuth 2.0 credentials (Web application)
4. Add redirect URIs: `http://localhost:5173/auth/callback` (and 5174, 5175 if needed)
5. Add your email as Test user (OAuth consent screen → Test users)
6. Put Client ID and Client Secret in `backend/.env`

**Note:** Frontend is pinned to port 5173 in `vite.config.ts` — do not change; Google OAuth redirect depends on it.

### Zoho Setup

**Personal/Free (@zohomail.com):** Use UI "Add Zoho" — leave "Custom domain" unchecked.

**Custom domain (e.g. @agentrain.me):** Use UI "Add Zoho" — check "Custom domain (smtppro/imappro)". Requires App Password from [Zoho Account Security](https://accounts.zoho.com) → Security → Application-Specific Passwords.

**Batch add:** Edit `backend/scripts/add-accounts.ts`, fill the `ACCOUNTS` array, then run:
```bash
cd backend && npx tsx scripts/add-accounts.ts
```

### ValidKit Email Validation

Optional: validate emails before upload to reduce bounce rate. Uses [ValidKit](https://validkit.com) API.

1. Sign up at [validkit.com](https://validkit.com/get-started), get API keys (1000 free validations/month per key).
2. Add to `backend/.env`:
   ```
   VALIDKIT_API_KEYS=key1,key2,key3,...
   VALIDKIT_RESET_DAYS=17
   ```
3. `VALIDKIT_RESET_DAYS` = day of month when quota resets (1–28). Default 17. Use comma-separated values for per-key reset days, e.g. `17,17,25` for 3 keys.
4. **When adding NEW keys** (beyond the initial set) with a different billing cycle, **you MUST ask the user for their reset day** and add it to `VALIDKIT_RESET_DAYS`. See `backend/src/services/validkit.ts` for details.
5. **Validation backups:** After each validation run, results are saved to `backend/validated-backups/` as JSON files (e.g. `validated-2025-02-17T14-30-45.json`). This preserves ValidKit tokens — if upload fails, you can reuse the backup without re-validating. Backups are not stored in the database.

### Reply Check (optional)

- `REPLY_CHECK_GMAIL_LIMIT` — max sent emails to check per account per run (default 150). Lower if hitting Gmail API rate limits.

### Deploy to Railway (GitHub + production)

1. **Push to GitHub:** Create a repo and push the code.
2. **Railway:** Sign up at [railway.app](https://railway.app), create a new project.
3. **Deploy from GitHub:** In Railway, click "Deploy from GitHub repo" and connect your repository. Railway auto-detects the build (`npm run build`) and start (`npm run start`) from root `package.json`.
4. **Environment variables:** In Railway project → Variables, add:
   - `DATABASE_URL` — use Railway's SQLite or add PostgreSQL plugin for production
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`
   - `FRONTEND_URL` — your Railway app URL (e.g. `https://your-app.up.railway.app`)
5. **Google OAuth:** Add your Railway URL to Google Cloud Console redirect URIs: `https://your-app.up.railway.app/auth/callback`
6. **GitHub Actions (optional):** For deploy on push, add `RAILWAY_TOKEN` (from Railway → Settings → Tokens) to GitHub repo secrets. The workflow in `.github/workflows/deploy.yml` will deploy on push to `main`/`master`.

**Note:** In production, backend serves the frontend from a single URL. SQLite on Railway uses ephemeral storage unless you add a Volume — consider PostgreSQL for persistent data.

---

## 4. File Structure

```
/
├── README.md
├── package.json
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── scripts/
│   │   ├── add-accounts.ts      # Batch add Zoho accounts
│   │   └── send-test-email.ts   # Send test / follow-up email
│   ├── src/
│   │   ├── index.ts
│   │   ├── lib/
│   │   │   ├── prisma.ts
│   │   │   ├── logger.ts       # formatError, info/warn/error → stdout
│   │   │   ├── encryption.ts
│   │   │   ├── msk.ts
│   │   │   ├── throttle.ts      # Human-like delay distribution (40/45/15%)
│   │   │   ├── accounts.ts
│   │   │   ├── validateCampaign.ts
│   │   │   ├── replyType.ts      # Bounce/auto-reply detection
│   │   │   └── gmailBody.ts      # Gmail body extraction (recursive multipart, attachmentId, charset)
│   │   ├── routes/
│   │   │   ├── accounts.ts
│   │   │   ├── auth.ts
│   │   │   ├── campaigns.ts
│   │   │   ├── leads.ts
│   │   │   ├── history.ts
│   │   │   └── stats.ts
│   │   └── services/
│   │       ├── gmail.ts
│   │       ├── zoho.ts
│   │       ├── validkit.ts      # Multi-key email validation (ValidKit API)
│   │       ├── personalize.ts
│   │       ├── scheduler.ts
│   │       ├── replyChecker.ts  # Gmail/Zoho reply detection, re-check empty body, batch limit
│   │       ├── campaignStart.ts
│   │       └── campaignCompletion.ts
│   ├── validated-backups/       # JSON backups of ValidKit validation results (created on first validation)
│   ├── .env
│   └── package.json
└── frontend/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── api.ts
    │   ├── index.css
    │   ├── components/
    │   │   └── RichTextEditor.tsx
    │   ├── lib/
    │   │   └── emailLimits.ts    # Gmail/RFC limits, getUtf8ByteLength, formatBytes
    │   └── pages/
    │       ├── Dashboard.tsx
    │       ├── Accounts.tsx
    │       ├── Campaigns.tsx
    │       ├── CampaignEdit.tsx
    │       ├── History.tsx
    │       ├── Replies.tsx
    │       └── AuthCallback.tsx
    ├── index.html
    ├── vite.config.ts
    └── package.json
```

---

## 5. Data Model

### EmailAccount

- id, email, displayName, accountType (google | zoho)
- dailyLimit (default: 100)
- limitResetAt, sentToday
- oauthTokens (Google) / smtpPasswordEncrypted (Zoho)
- zohoProServers (Zoho custom domain → smtppro.zoho.com / imappro.zoho.com)
- isActive, createdAt

**No working hours** — they are set per campaign only.

### Campaign

- id, name, dailyLimit, status (draft | active | paused | finished)
- startTime (nullable — null = start immediately)
- workingHoursStart, workingHoursEnd (MSK)
- createdAt

### Sequence (1 per Campaign)

- throttleMinMinutes, throttleMaxMinutes (e.g. 2–5)
- Throttle: **per account within campaign** — each account has its own delay queue. Human-like distribution: 40% fast, 45% normal, 15% slow (cap 20 min). When leads are assigned, first lead per account gets baseDate (all accounts can send in parallel); subsequent leads per account get baseDate + accumulated throttle.

### SequenceStep

- stepOrder, subjectTemplate, bodyTemplate, delayAfterPreviousDays
- Default: 1 initial step; follow-ups added via "+ Add follow-up" button

### Lead

- campaignId, email, data (JSON), orderIndex, assignedAccountId
- currentStep (number of emails sent = 0, 1, 2…), nextSendAt, status
- **status:** pending | sent | replied | bounce | auto_reply | paused

**orderIndex:** Preserves CSV row order. Leads are listed, assigned, and sent in the same order as in the uploaded file (including after validation filtering).

**One account per lead:** When campaign starts, each lead is assigned an account. That account sends the initial email and all follow-ups to that lead.

### SentEmail

- leadId, accountId, campaignId, stepOrder, subject, bodyPreview
- sentAt, status (sent | replied | bounce | auto_reply)
- gmailMessageId, gmailThreadId / messageId (for reply detection and threading)
- **replyBody** — full text of the reply (stored when reply detected)
- **replyAt** — when the reply was received
- **replyType** — human | bounce | auto_reply (detected from content + timing)

### ValidKitKeyUsage

- keyIndex, keyLabel (last 8 chars for display)
- usedThisMonth, lastResetAt, resetDay (1–28)
- Tracks per-key usage for ValidKit API (1000/month per key, 60 req/min per key)

---

## 6. UI Structure

### Campaigns List

- Create: click "New Campaign" → enter name → create immediately → redirect to edit
- Table: name, status (draft | active | paused | finished), progress %, daily limit, leads count
- Delete campaign

### Navigation

- **Dashboard** — stats, campaign list
- **Email Accounts** — Gmail (OAuth) and Zoho
- **Campaigns** — create, list, edit
- **Replies** — all replies (human, bounce, auto-reply) with full text; filter by campaign and type; expand to read reply body; Expand/Collapse for long replies; "Body not extracted" + Refresh button when body missing
- **History** — all sent emails with status

### Campaign Edit — Tabs

1. **Settings** — name, daily limit, start time (or "Start immediately"), working hours, email accounts, throttle, sequence steps
2. **Leads** — CSV upload + table of leads (headers = personalization columns, email required)

### Settings Tab

- **Send capacity:** Live estimate of emails/day and days to finish. Updates as you change working hours, throttle, daily limit, accounts, or leads. Uses min(throttle capacity, campaign limit, account limits).
- **Save:** "Saved" feedback when changes applied
- **Sequence:** each step (initial + follow-ups) has Subject, Body, Preview button
- **Preview:** modal with recipient/sender picker (from leads + campaign accounts), shows personalized email
- **Remove follow-up:** only the last follow-up can be removed (remove last first)
- **Active/paused:** hint that edits apply to unsent emails only

### Leads Tab

- **Upload CSV:** First row = column names (email required), rows below = data. If a cell contains multiple emails (comma/semicolon/newline-separated), each becomes a separate lead with the same row data.
- **ValidKit validation (optional):** If `VALIDKIT_API_KEYS` is set, after selecting a CSV you can "Validate emails". Results: Valid / Invalid / Risky. Three options: remove invalid & risky, remove risky only, or keep all. **Validation results are backed up** to `backend/validated-backups/` after each run — you won't lose tokens if upload fails.
- **CSV order preserved:** Leads are uploaded, listed, and sent in the same order as in the CSV file (including when filtering by validation).
- **ValidKit usage:** Displays per-key usage (used/1000, remaining, reset day).
- Table: CSV columns, **Emails sent** (X / Y), Status
- All CSV columns become `{{column_name}}` for personalization (double curly braces, case-sensitive)

### Email Accounts

- **Google:** Connect via OAuth (redirect to Google, then callback)
- **Zoho:** Add manually — email, App Password, optional "Custom domain" checkbox

---

## 7. Business Logic

- **Campaign creation:** Quick create — name → create → configure settings
- **Campaign name:** Optional; empty → "Untitled Campaign"
- **Campaign status:** draft → active → paused | finished. **Finished** when all leads done (replied or received all steps)
- **Completion %:** leads done / total leads. Recalculated when leads added, sequence changed, email sent, reply detected
- **Start immediately:** If startTime is null, campaign starts right away
- **Working hours:** Only in campaign (not in email accounts)
- **CSV:** First row = headers. Email column required (looks for "email", "e-mail", or "emails"). Multiple emails per cell (comma/semicolon/newline) → split into separate leads. All columns → `{{name}}`, `{{company}}`, etc. (double curly braces, case-sensitive). Possessive: `{{Name's}}` → John's (appends 's to the value). **Order preserved:** Leads keep CSV row order for listing and sending (orderIndex).
- **Email body:** Rich text editor (Tiptap) — Bold, Italic, Strikethrough, bullet/numbered lists. Emails sent as HTML with plain-text fallback. Body limited to 25 MB, subject to 998 chars (see §8).
- **Deduplication:** By email, within file and across campaigns
- **Email validation (ValidKit):** Multi-key parallel validation (60 req/min per key). Valid = deliverable; Invalid = garbage; Risky = disposable/catch-all. Filter before upload.
- **Throttle:** Per **account** within campaign. Each account has its own queue; accounts send in parallel. Human-like distribution: 40% fast, 45% normal, 15% slow (cap 20 min). On campaign start, first lead per account gets nextSendAt = baseDate; subsequent leads per account get baseDate + accumulated throttle. After send, next lead for that account gets nextSendAt = now + delay.
- **Scheduler:** Runs every 10 seconds (`setInterval`). Per run, processes **up to one lead per account** per campaign — all accounts can send in parallel. Emails are sent shortly after throttle expires (within ~10 sec). Throughput scales with account count. With throttle 2–5 min, each account sends ~12–30/hour; e.g. 5 accounts ≈ 60–150/hour, 15 accounts ≈ 180–450/hour (within working hours).
- **Follow-up delay:** Days between sequence steps
- **Follow-up threading (Zoho):** Follow-ups use In-Reply-To and References headers so they appear as replies in the same thread
- **Edit sequence during run:** New content applies to unsent emails. Already-sent emails keep their content and status.
- **Remove follow-up:** Only the last follow-up can be removed (must remove in order)
- **Reply detection:** Every 3 min (cron `*/3 * * * *`). Gmail via threadId (format: full), Zoho via IMAP. Stores reply body, replyAt, replyType. **Re-check:** replied/bounce/auto_reply with empty replyBody are re-processed to backfill body. **Gmail:** recursive multipart extraction, attachmentId fetch when body.data null, charset from Content-Type; messages sorted by internalDate; batch limit 150 (env `REPLY_CHECK_GMAIL_LIMIT`), 100 ms delay between requests; lock prevents concurrent runs. **Zoho:** INBOX + Junk + Spam folders; last 500 emails; recursive multipart in body extraction; charset support.
- **Bounce/auto-reply detection:** Replies are classified as **human**, **bounce** (delivery failed, user unknown, etc.), or **auto_reply** (out of office, vacation, etc.). Fast replies (&lt; 5 min) without clear human content → auto_reply. Bounce/auto_reply leads stop receiving follow-ups.
- **Pause:** Manual or auto when campaign/account limits reached
- **Paused campaign protection:** Paused campaigns are never auto-changed to "finished". Only **active** campaigns auto-finish when all leads are done. You control when to resume or finish a paused campaign.

---

## 8. Email Limits (Gmail & RFC)

The app enforces Gmail and email standards so messages are accepted by providers.

| Limit | Value | Source |
|-------|-------|--------|
| **Message size** | 25 MB (body + attachments + headers) | [Gmail](https://support.google.com/mail/answer/6584) |
| **Subject line** | 998 characters max | RFC 5322 |
| **Daily sends** | 500 emails (personal Gmail) | [Gmail](https://support.google.com/mail/answer/22839) |

### Where limits are enforced

- **RichTextEditor** (`frontend/src/components/RichTextEditor.tsx`): Blocks input when body exceeds 25 MB. Shows size counter when body > 100 KB.
- **CampaignEdit** (`frontend/src/pages/CampaignEdit.tsx`): Validates subject ≤ 998 chars and body ≤ 25 MB on save. Subject input has `maxLength={998}`.
- **Gmail send** (`backend/src/services/gmail.ts`): Throws before sending if full message > 25 MB.
- **Constants** (`frontend/src/lib/emailLimits.ts`): `GMAIL_MAX_MESSAGE_BYTES`, `EMAIL_MAX_SUBJECT_CHARS`, `getUtf8ByteLength()`, `formatBytes()`.

**When modifying limits:** Update `frontend/src/lib/emailLimits.ts` and `backend/src/services/gmail.ts` (GMAIL_MAX_MESSAGE_BYTES) to keep them in sync.

---

## 9. Scripts

### add-accounts.ts

Batch add Zoho accounts. Edit `ACCOUNTS` array, then:
```bash
cd backend && npx tsx scripts/add-accounts.ts
```

### send-test-email.ts

Send a test email or follow-up (as reply):
```bash
cd backend && npx tsx scripts/send-test-email.ts [to-email]           # initial
cd backend && npx tsx scripts/send-test-email.ts [to-email] followup # reply
```

---

## 10. Logging and Debugging

All backend logs go to **stdout** (console). When running `npm run dev`, logs appear in the terminal.

### Log format

```
[2025-02-17T12:00:00.000Z] [INFO] Server running on port 3001
[2025-02-17T12:01:00.000Z] [INFO] Attempting send { leadId, to, accountId, campaignId, step }
[2025-02-17T12:01:01.000Z] [INFO] Gmail sent { to, messageId, threadId }
[2025-02-17T12:01:01.000Z] [INFO] Sent email { leadId, to, step }
```

### Email send flow — what gets logged

| Event | Log message | Context |
|-------|-------------|---------|
| Before send | `Attempting send` | leadId, to, accountId, campaignId, step |
| Gmail success | `Gmail sent` | to, messageId, threadId |
| Zoho success | `Zoho sent` | to, messageId |
| After DB save | `Sent email` | leadId, to, step |
| Send failed | `Send failed` | leadId, to, accountId, campaignId, step, message, stack |
| Scheduler crash | `Scheduler error` | message, stack |
| Reply detected | `Reply detected` | leadId, replyType, campaignId |
| Reply body backfilled | `Reply body backfilled` | sentEmailId |
| Reply found but body empty | `Reply found but body empty` | sentEmailId, gmailMessageId, partsStructure |
| Reply check failed for thread | `Reply check failed for thread` | sentEmailId, gmailThreadId, error |
| Reply check crash | `Reply check error` | message, stack |

### Campaign skip reasons (INFO)

- `Campaign skipped: no sequence steps`
- `Campaign skipped: outside working hours`
- `Campaign daily limit reached`
- `Campaign skipped: no email accounts`
- `Campaign skipped: no active accounts`
- `All accounts at limit, pausing campaign`

### Common errors and causes

| Log | Likely cause |
|-----|--------------|
| `Send failed` + "No OAuth tokens" | Gmail: re-connect account via OAuth |
| `Send failed` + "No SMTP password" | Zoho: add App Password for account |
| `Send failed` + "Message exceeds Gmail limit" | Body > 25 MB — shorten email |
| `Send failed` + network/timeout | Gmail API or Zoho SMTP unreachable |
| `getGmailMessageIdHeader failed` | Gmail API error fetching metadata (follow-up threading may not work) |
| `Zoho IMAP check failed` | Zoho IMAP unreachable — reply detection may miss replies |
| `Reply check failed for thread` | Gmail thread fetch failed (deleted, rate limit, auth) — reply body may be missing |
| `Zoho reply check start` | Zoho reply check: accountId, sentCount, ourIdsSample |
| `Zoho folder matches` | Zoho: matches found in folder (INBOX/Junk/Spam) |
| `Zoho body extraction returned empty` | Zoho: raw fetched but extractZohoBodyFromRaw returned empty |
| `Zoho match but body empty` | Zoho: reply matched but body extraction failed |
| `Scheduler error` | Unhandled exception in entire send cycle |
| Safari: "The string did not match the expected pattern" | Server returned HTML instead of JSON (e.g. 500 error page). Check server logs for real error. Frontend now checks Content-Type before parsing. |

### Where to look

- **Logs:** Terminal where backend runs, or redirect stdout to a file: `npm run dev 2>&1 | tee backend.log`
- **Sent emails:** History tab in UI, or `SentEmail` table in DB
- **Lead status:** Campaign Edit → Leads tab (pending / sent / replied / bounce / auto_reply)
- **Replies:** Replies tab — view all replies with full text; filter by campaign and type; expand row, Expand/Collapse for long replies; Refresh button when body not extracted

---

## 11. Key Decisions Log

| Decision | Reason |
|----------|--------|
| SQLite | Single-user, local, no extra infra |
| OAuth for Google | Required by Google |
| Frontend port 5173 fixed | Google OAuth redirect URI |
| Working hours only in campaign | User request — one place to configure |
| Throttle per account | Like Instantly — human-like delay (40/45/15% buckets) between sends from same inbox; per-account queue so all accounts send in parallel |
| Start immediately option | User request |
| Leads as separate tab | Clearer UX, table view |
| Campaign name optional | User request |
| Sequence: 1 step + add button | User request — no pre-filled follow-ups |
| Quick campaign create | User request — name → create → configure |
| Campaign finished status | When all leads done (replied or all steps sent) |
| Completion % on campaign | User request — track progress |
| Edit sequence during run | New content for unsent only; sent keep status |
| Remove only last follow-up | User request — prevents gaps in sequence |
| One account per lead | Same sender for initial + all follow-ups |
| Zoho custom domain (zohoProServers) | smtppro/imappro for paid/custom domains |
| Zoho follow-up threading | In-Reply-To/References for reply-in-thread |
| ValidKit multi-key validation | Reduce bounce rate; ask reset day when adding new keys |
| Scheduler: one lead per account per run, every 10 sec | Throughput scales with account count; throttle limits per account; 10 sec interval for precise send timing |
| Email limits (25 MB, 998 chars subject) | Gmail/RFC; prevent bounce; enforce in editor, form, backend |
| Logging: Attempting send + formatError | Debug send failures; Error objects don't stringify well |
| Lead orderIndex | Preserve CSV order for listing and sending |
| Validation backups | Save ValidKit results to disk — no token loss if upload fails |
| Multer fieldSize 5 MB | Allow large validationResults in FormData |
| Express global error handler | Always return JSON for API routes (avoids Safari "string did not match pattern") |
| Frontend upload: Content-Type check | Handle non-JSON server responses gracefully |

---

## 12. Scalability

- **Throughput:** Limited by throttle (human-like 2–5 min per account, 15% slow pauses up to 20 min) and daily limits. More accounts = more parallel sends.
- **CSV upload:** 10 MB file limit, 5 MB form field limit (validationResults). Leads inserted in batches of 300 (SQLite bind parameter limit). Sufficient for ~10k+ leads with typical column sizes.
- **SQLite:** Suitable for single-user, tens of thousands of leads and sent emails.

---

## 13. When Modifying

1. Read this file first
2. Respect the data model and business rules
3. Update this file if you change architecture or scope
4. Keep this file up to date — it is the single source of truth
5. If changing email limits: update §8, `frontend/src/lib/emailLimits.ts`, and `backend/src/services/gmail.ts`
6. If changing logging: update §10 and `backend/src/lib/logger.ts`

---

## 14. Changelog

### 2026-02-19 (follow-up 3) — GitHub + Railway deploy

**Production deploy:**
- Backend serves frontend static files in production (`NODE_ENV=production`, `backend/public/`)
- Root `package.json`: `build` copies frontend dist to `backend/public`, `start` runs backend
- `railway.json` — Railway build/start config
- `.github/workflows/deploy.yml` — GitHub Actions: build + deploy to Railway on push to main
- README §3: Deploy to Railway (GitHub + production) — step-by-step

### 2026-02-19 (follow-up 2) — Replies sort by received, bounce detection improvements

**Replies tab:**
- Sort by `replyAt` (newest first) when filtering replied/bounce/auto_reply
- Column "Date" renamed to "Received"; shows reply received time + sent time below
- Backend `GET /api/history`: `orderBy` uses `replyAt desc` when status filter is replies-only

**Bounce detection (`replyType.ts`):**
- Extended `BOUNCE_PATTERNS`: `could not be delivered`, `sender address blocked`, `mail delivery software`, `created automatically by mail`, `action: failed`, `diagnostic-code`, `reporting-mta`, `554` + DSN code
- Fixes misclassification of DSN bounces (e.g. "Sender Address Blocked") as human

### 2026-02-19 — Reply body extraction improvements, re-check, UI, refresh API

**Gmail body extraction (`gmailBody.ts`):**
- Recursive traversal for nested multipart (e.g. multipart/mixed → multipart/alternative → text/plain)
- Fetch body via `messages.attachments.get()` when `body.data` is null (large messages)
- Charset support from Content-Type (utf-8, latin1)
- Function is now async; accepts opts `{ gmail, userId, messageId }` for attachment fetch

**Reply checker (`replyChecker.ts`):**
- Re-check replied/bounce/auto_reply with empty replyBody — backfill body on next run
- Sort thread messages by internalDate before finding reply
- Batch limit 150 (env `REPLY_CHECK_GMAIL_LIMIT`), 100 ms delay between Gmail requests
- Lock prevents concurrent checkReplies runs
- Proper logging: `Reply check failed for thread`, `Reply found but body empty`
- Zoho: INBOX + Junk + Spam folders; last 500 emails (was 200)
- Zoho: recursive multipart in `extractZohoBodyFromRaw`; charset in `decodePartBody`
- Zoho: re-check for replied with empty body

**API:**
- `POST /api/history/:id/refresh-reply` — manually re-fetch reply body (Gmail and Zoho)

**UI (Replies tab):**
- Reply body maxHeight 500 (was 300); Expand/Collapse button for full view
- "Body not extracted" + Refresh button when reply detected but body empty

### 2026-02-19 (follow-up) — Zoho manual refresh, diagnostic logging, Sent folder, bounce search, body truncation fix

**Zoho folders:**
- Added Sent, Sent Items to search (replies often appear in Sent in Zoho)

**Bounce detection:**
- When In-Reply-To/References are empty, search by Message-ID in body — finds bounces (DSN) that don't have these headers

**Body truncation fix:**
- `extractZohoBodyFromRaw`: split by actual boundary instead of `\n--` — signatures with `--` no longer truncate the body
- Support for non-standard boundary format (e.g. `boundary="--_NmP-..."`)

**Zoho manual refresh:**
- `POST /api/history/:id/refresh-reply` now supports Zoho — IMAP search in INBOX/Sent/Junk/Spam, fetch body, update replyBody

**Zoho diagnostic logging:**
- `Zoho reply check start` — accountId, sentCount, ourIdsSample
- `Zoho folder matches` — when matches found in a folder
- `Zoho body extraction returned empty` — raw length, preview, hasMultipart (when extractZohoBodyFromRaw returns empty)
- `Zoho match but body empty` — when reply matched but body extraction failed

### 2026-02-17 — Reply body storage, bounce/auto-reply detection, Replies tab

**Schema:**
- `SentEmail`: added `replyBody`, `replyAt`, `replyType`; status extended to `replied | bounce | auto_reply`
- `Lead`: status extended to `replied | bounce | auto_reply`

**Reply detection:**
- Gmail: `threads.get` now uses `format: "full"` to fetch reply body; body extracted from payload
- Zoho: second IMAP fetch for matched UIDs to get full message body; simple MIME parser for text extraction
- New `backend/src/lib/replyType.ts`: detects bounce (delivery failed, user unknown, etc.) and auto-reply (out of office, vacation, etc.) from content + timing
- Reply within 5 min without clear human content → classified as auto_reply

**Campaign completion:**
- `bounce` and `auto_reply` leads now count as "done"
- **Paused campaigns:** Only `active` campaigns auto-finish when all leads done. Paused campaigns stay paused — user controls when to resume or finish.

**API:**
- `GET /history?status=replied` or `status=replied,bounce,auto_reply` — filter by status

**UI:**
- New **Replies** tab: view all replies with full text; filter by campaign and type (human / bounce / auto-reply); expand row to read reply body
- History: status badges for bounce (red) and auto_reply (amber)
