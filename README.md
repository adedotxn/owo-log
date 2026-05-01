# owo-log

Personal finance automation tool. Reads Moniepoint transaction alert emails from Gmail, categorizes them using a Google Sheet-driven category map, and appends structured rows to the same sheet.

## How it works

1. Connects to Gmail and fetches emails matching `subject:"Debit alert" OR subject:"Credit alert"` from `moniepoint.com`
2. Parses each email to extract amount, balance, date/time, narration, and direction
3. Reads the **Categories** tab in your Google Sheet to build a keyword-to-category map
4. Matches each transaction's narration against the keywords
5. Appends rows to the **Transactions** tab, grouped under a coloured period separator
6. Writes a per-period summary block to the **Summary** tab
7. Anything unmatched is written as `Uncategorized` with `Flagged = YES`

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- A Google account with Moniepoint transaction emails
- A Google Cloud project with Gmail API and Google Sheets API enabled

## Setup

### 1. Install dependencies

```sh
bun install
```

### 2. Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Gmail API** and **Google Sheets API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Choose **Application type: Desktop app**, give it a name, click Create
6. Copy the **Client ID** and **Client Secret**

### 3. Configure environment

```sh
cp .env.example .env
```

Fill in `.env`:

```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=        # filled in next step
SHEET_ID=                    # filled in next step
```

### 4. Authenticate

```sh
bun run setup
```

This prints a Google OAuth consent URL. Open it in your browser, grant access to Gmail (read) and Google Sheets, then paste the authorization code back into the terminal.

The script will then ask:
- **Write token to `.env`?** — say `Y` to update `GOOGLE_REFRESH_TOKEN` automatically, or `n` to copy it manually.
- **Create missing sheet tabs?** — if `SHEET_ID` is already in `.env`, it will detect and offer to create any missing tabs with the correct headers.
- **Run `bun run sync` now?** — say `Y` to kick off the first sync immediately.

### 5. Create the Google Sheet

Create a new Google Sheet. The Sheet ID is the long string in the URL:
```
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```

Add it to `.env` as `SHEET_ID=` before running `bun run setup` (or before the first sync).

All three required tabs are created automatically with correct headers the first time you run `bun run sync` or `bun run setup`. You can also create them manually:

#### Transactions tab (A–J)

| Date | Time | Amount | Direction | Narration | Category | Balance | Bank | Flagged | Period |
|---|---|---|---|---|---|---|---|---|---|
| 30/04/2026 | 14:23:01 | 4500 | debit | POS PURCHASE SHOPRITE | Groceries | 120000 | Moniepoint | | 01/04/2026–30/04/2026 |
| 30/04/2026 | 09:10:44 | 15000 | credit | TRANSFER FROM JOHN DOE | Uncategorized | 135000 | Moniepoint | YES | after:24/04/2026 |

Each sync batch is visually separated by a **coloured header row** and the transaction rows below it are **collapsible** (click the `▸` toggle in the left margin). The **Period** column (J) labels every row with its sync range.

#### Categories tab (A–B)

| Category | Keywords |
|---|---|
| Food Delivery | FoodExpress, Foodhut, Captain Cook, Leeyah |
| Groceries | SHOPRITE, SPAR, Justrite |
| Transport | UBER, BOLT, RIDEPOOL |
| Near-home Groceries | MARY NGOZI, ROSE TSOGBE |

Keywords are comma-separated and matched case-insensitively against the transaction narration. Add or edit rows here at any time — the script reads this tab fresh on every run. Any transaction with no keyword match is written as `Uncategorized` with `Flagged = YES`.

#### Summary tab

Automatically written after every sync. Each period gets its own block:

```
── 01/04/2026–30/04/2026 ──
Category          Debits (₦)   Credits (₦)
Groceries         45,000        0
Transport         8,200         0
Uncategorized     3,000         0
TOTAL             56,200        15,000
```

Rows use live `SUMIFS` formulas filtered by period, so they stay accurate if you edit transactions or categories. Re-running the same sync range skips the summary write — it only appends once per period.

## Usage

```sh
# Incremental sync — fetches since last run (defaults to past 7 days on first run)
bun run sync

# Sync a specific date range
bun run sync -- --start '25/02/2026' --end '30/05/2026'

# Start date only — end defaults to today
bun run sync -- --start '01/04/2026'
```

Dates are in `DD/MM/YYYY` format. Each run **appends** rows — existing rows are never overwritten or deleted.

**Duplicate handling:**
- Incremental syncs skip any transaction already in the sheet (matched on date, time, amount, narration)
- Range syncs only dedup within the same period label — so two overlapping ranges each keep their own rows, letting you compare the same time window queried at different points

The last sync timestamp is saved to `.last-sync` after each successful incremental write. Delete this file to re-sync from scratch. Range syncs (`--start`) never modify `.last-sync`.

## Adding a new bank

Each bank has its own parser in `src/parsers/`. To add support for a new bank (e.g. Kuda):

1. Create `src/parsers/kuda.ts` implementing the `EmailParser` type
2. Call `registerParser("kuda", parseKuda)` at the bottom of the file
3. Add `import "./parsers/kuda.ts"` to `src/index.ts`

The parser receives the email subject and plain-text body and returns a `Transaction` or `null` if it doesn't recognize the email.

## Project structure

```
src/
  index.ts          # Orchestrator — runs the full sync flow
  types.ts          # Shared TypeScript interfaces
  summary.ts        # Per-period summary block writer
  auth/
    google.ts       # OAuth2 token refresh
  gmail/
    client.ts       # Gmail API: list and fetch messages
  sheets/
    client.ts       # Sheets API: read ranges, append rows, grouping, formatting
  parsers/
    registry.ts     # Bank parser registry
    moniepoint.ts   # Moniepoint email parser
  categorizer.ts    # Loads category rules from sheet, matches transactions
scripts/
  setup-auth.ts     # One-time OAuth2 setup flow
```

## GitHub Actions (coming soon)

The sync can be automated via a scheduled GitHub Actions workflow. Store all `.env` values as repository secrets and run `bun run sync` on a cron schedule.
