# Chisti & Co. — property portfolio dashboard

A self-hosted dashboard for a UK rental portfolio, forked from
[clawnify/OpenProperty](https://github.com/clawnify/OpenProperty) and reshaped
around the way a landlord actually runs things from a spreadsheet: one row per
home, several owning companies, mixed deal types, rent in and out, arrears and
the compliance certificates.

Everything is in pounds, UK dates and UK terms. Every page sits behind a login.

## What's in it

**Dashboard** — rent in, money out, net profit and margin, total arrears, and
compliance at a glance. A cashflow chart of rent arriving and rent/mortgage
leaving by day of the month. Totals by owning company and by deal type, and a
list of homes that need attention (vacant, eviction in process, in arrears).

**Properties** — a sortable, filterable table of every home: ref, address,
owner, deal type (owned / joint venture / rent to rent / ground rent), HMO,
occupancy, tenant or agent, rent in, rent/mortgage out, other costs, net, rent
status and arrears. Each home has its own page with its figures, certificates,
units and work orders.

**Compliance** — gas safety, EPC, EICR, licence and insurance expiry dates for
every home. Expired certificates turn red, anything due within 60 days amber,
and homes with no dates recorded are listed so they can be filled in.

**Certificates & documents** — upload the actual gas safety certificate,
EICR, EPC, licence and insurance (PDF, photo or Word, up to 20 MB) against
each home, from the Compliance page or the home's own page. Files are kept
on the server's disk next to the database (`DOCUMENTS_DIR` to change it),
only signed-in users can open them, and they are never in the repository.

**Sales leads** — landlords selling, with contact details, the property,
asking price, offer, buyer/agent, solicitor, status and next action.

**Also kept from OpenProperty** — tenants, leases, a monthly rent ledger with
payments (bank transfer, standing order, cash, card), maintenance work orders,
and a contractor directory.

## Stack

- React 19 + Vite + TypeScript, Tailwind CSS v4 + shadcn/ui
- Hono API — the same code runs on **Render / any Node 22 host** (SQLite via
  the built-in `node:sqlite`) or on **Cloudflare Workers** (D1)

## Login

Everyone has their own username and password (Settings → Users, admins
only). Company data is shared; **mailboxes are private**: each person sees
only the mailboxes ticked for them, e.g. everyone gets `info@` and each
person their own address. The Ask assistant and invoice "Send from" follow
the same rule: you can send as a shared address (Settings → Invoicing) or
as yourself, never as a colleague.

Passwords are stored as PBKDF2 hashes; changing one signs that person out
everywhere. `APP_PASSWORD` signs the session cookies and, together with
`APP_USERNAME` (default `admin`), is a **setup login** that only works until
the first admin account exists. Set `ALLOW_SETUP_LOGIN=true` to re-enable it
if every admin is locked out. Locally, `ALLOW_NO_AUTH=true` skips sign-in.

## Deploy on Render

1. In Render, choose **New → Blueprint** and select this repository. It reads
   `render.yaml`: one web service plus a 1 GB disk mounted at `/var/data`.
2. Enter an `APP_PASSWORD` when prompted.
3. Wait for the first deploy, then open the URL and log in.

The disk needs a paid instance (Starter or above). On Render's free plan there
is no disk: the database is rebuilt whenever the app restarts or wakes from
sleep. To keep the portfolio there anyway, add the import payload as a
**secret file** named `portfolio.json` and set `SEED_FILE=/etc/secrets/portfolio.json`
(and `DATABASE_PATH=./data/portfolio.db`) — the app loads it on every start.
Changes made in the app since the last restart are lost on the free plan.

Manual setup instead of the Blueprint: a Node web service with build command
`npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 run build`,
start command `node --disable-warning=ExperimentalWarning dist-server/node.js`,
a disk at `/var/data`, and env vars `DATABASE_PATH=/var/data/portfolio.db`,
`NODE_VERSION=22.20.0`, `APP_PASSWORD`.

## Invoices

**Invoices** creates branded Chisti & Co. invoices (rent, ground rent, service
charge, anything) with a printable view (save as PDF from the browser) and
emails them. Company and bank details go in **Settings → Invoicing**.

Nothing is emailed until someone presses **Send** and confirms. To switch on
email, create a free [Resend](https://resend.com) account, verify your
sending domain (DNS records for e.g. chistiandco.com), and set:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | from Resend → API Keys |
| `INVOICE_FROM_EMAIL` | optional default "from" address, e.g. `accounts@chistiandco.com` |

Each invoice can be sent from a different address: the Send step has a
**Send from** box, filled from the list in Settings → Invoicing and
remembering the last one used. Any address on a domain verified in Resend
works.

### Rent invoices, a week ahead

Every hour the app drafts a rent invoice for each rent falling due in the
next 7 days (Settings → Invoicing changes the number of days and the
send-from address, default `info@chistiandco.com`). Homes with rooms on the
Tenants tab get one invoice per room; other homes one for the whole rent.
Tenant emails come from the sheet's **Tenant Email** column. The drafts show
on the dashboard and at the top of Invoices, where one **Send** (after a
confirmation) emails them all. Each rent is drafted once per month, so a
deleted draft does not come back.

## Ask (AI assistant)

The **Ask** button on every page answers questions from the live data ("who's
in arrears?", "what goes out this week?") and can draft invoices. It can only
create drafts; sending is always a person's click. Set `ANTHROPIC_API_KEY`
(from console.anthropic.com) to switch it on; `ASSISTANT_MODEL` optionally
overrides the model (default `claude-sonnet-5-5`).

## Inbox

The **Inbox** page shows the company's existing mailboxes (read over IMAP;
One.com by default), with search, folders and attachments. Opening an email
marks it read; nothing is sent or deleted. Set in Render:

| Variable | Value |
|---|---|
| `MAIL_USER` | full address, e.g. `nabeel@chistiandco.com` |
| `MAIL_PASSWORD` | that mailbox's password |
| `MAIL_USER_2` / `MAIL_PASSWORD_2` … `_5` | optional extra mailboxes |
| `MAIL_HOST` / `MAIL_PORT` | optional, default `imap.one.com` / `993` |

The IMAP libraries are installed at build time into `server-deps/`
(`pnpm run build:mail-deps`). The Ask assistant can search the inbox too,
read-only, and treats email content as information, never instructions.

## Keep it in sync with a Google Sheet

Keep editing the spreadsheet and the dashboard follows. There are two ways to
link it.

**Private (recommended).** The sheet stays private. Open the sheet's
**Extensions → Apps Script**, paste in `scripts/sheet-endpoint.gs`, set its
`KEY` to a long random string, and **Deploy → New deployment → Web app**
(Execute as: *Me*, Who has access: *Anyone*). Then set `SHEET_SCRIPT_URL` to the
web app URL and `SHEET_SCRIPT_KEY` to the same key, plus the three `GID`
variables below. Without the key the script returns nothing.

**Published link.** In Google Sheets choose **File → Share → Publish to web → Entire
document → Comma-separated values (.csv) → Publish**, then set:

| Variable | Value |
|---|---|
| `SHEET_PUB_URL` | the published link (`https://docs.google.com/spreadsheets/d/e/…/pub?output=csv`) |
| `SHEET_PROPERTIES_GID` | the `gid=` number in the Properties tab's URL |
| `SHEET_COMPLIANCE_GID` | the Compliance tab's `gid` |
| `SHEET_SALES_GID` | the Sales tab's `gid` |
| `SHEET_RENT_TO_RENT_GID` | optional: a tab of homes managed for landlords (same columns as Properties) |
| `SHEET_TENANTS_GID` | optional: one row per room (Ref, Room, Tenant Name, Rent, Pay Day, Rent Paid, Tenancy Start/End, Notes) |
| `SYNC_MINUTES` | optional, default 5 |

The app reads the sheet on start, every few minutes, and when you press
**Sync now**. Properties are matched by Ref (or address), so their leases and
work orders are kept; homes deleted from the sheet are deleted here. Edits made
in the app to synced fields are replaced by the sheet at the next sync.

A published link is unlisted, but anyone who has it can read the sheet. Keep it
in Render's environment settings only, and unpublish the sheet (same menu) if
it ever leaks.

## Import your spreadsheet

Download each tab as CSV (File → Download → Comma-separated values) and put
them in `private/`, which git ignores. Then:

```bash
# Check what will be imported
node scripts/import-sheet.mjs --properties private/Properties.csv \
  --compliance private/Compliance.csv --sales private/Sales.csv --out private/payload.json

# Load it into the live app (replaces existing properties and leads)
APP_PASSWORD=... node scripts/import-sheet.mjs --properties private/Properties.csv \
  --compliance private/Compliance.csv --sales private/Sales.csv \
  --url https://your-app.onrender.com --replace
```

Column names are matched loosely (`Rent In`, `Monthly Gross Income`, `Deal
Type`, `Occupancy`, `Rent Paid`, `Months in Arrears`…), so a slightly different
sheet usually works as-is.

**Never commit portfolio data.** This repository is public; tenant names,
rents and lead contact details belong only in the deployed database.

## Develop

```bash
pnpm install
pnpm build && ALLOW_NO_AUTH=true pnpm start   # Node server at :8787, data in ./data/
# or, the Cloudflare way:
cp .dev.vars.example .dev.vars && pnpm dev    # Vite at :5173, Wrangler at :8787
```

## Deploy on Cloudflare instead

Create a D1 database, put its ID in `wrangler.toml`, apply
`src/server/schema.sql` to it, add an `APP_PASSWORD` secret, then
`pnpm deploy:cloudflare`.

## Project layout

```
src/
  server/
    index.ts        Hono routes, login, portfolio summary, import
    node.ts         Node entry (Render): SQLite + static files
    db.ts           One query / get / run API over D1 or SQLite
    schema.sql      Tables
  client/
    components/
      dashboard/    Portfolio KPIs, cashflow, owners, deal types
      properties/   Table, property page, property + unit dialogs
      compliance/   Certificate tracker
      sales/        Sales leads + lead dialog
      tenants/ leases/ rent/ maintenance/ settings/
    lib/portfolio.ts  UK labels, compliance rules, helpers
scripts/
  import-sheet.mjs  Spreadsheet CSV → app import
render.yaml         Render Blueprint
```

Licensed MIT, like the original.
