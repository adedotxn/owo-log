# owo-log

Personal finance automation tool. Reads Moniepoint transaction alert emails from Gmail, categorizes them using a Google Sheet-driven category map, and appends structured rows to the same sheet.

## How it works

1. Connects to Gmail and fetches emails matching `subject:"Debit alert" OR subject:"Credit alert"` from `moniepoint.com`
2. Parses each email to extract amount, balance, date/time, narration, and direction
3. Reads the **Categories** tab in your Google Sheet to build a keyword-to-category map
4. Matches each transaction's narration against the keywords
5. Appends rows to the **Transactions** tab
6. Anything unmatched is written as `Uncategorized` with `Flagged = YES`

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

This prints a Google OAuth consent URL. Open it in your browser, grant access to Gmail (read) and Google Sheets, then paste the authorization code back into the terminal. Copy the printed refresh token into your `.env`.

### 5. Create the Google Sheet

Create a new Google Sheet. The Sheet ID is the long string in the URL:
```
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```

Add it to `.env` as `SHEET_ID=`.

The sheet needs three tabs set up as follows:

**Transactions** — add this header in row 1 (one word per column, A–I):

| Date | Time | Amount | Direction | Narration | Category | Balance | Bank | Flagged |

**Categories** — header in row 1, rules from row 2:

| Category | Keywords |
|---|---|
| Food Delivery | FoodExpress, Foodhut, Captain Cook, Leeyah |
| Near-home Groceries | MARY NGOZI, ROSE TSOGBE |
| ... | ... |

Keywords are comma-separated and matched case-insensitively against the transaction narration. Add or edit rows here at any time — the script reads this tab fresh on every run.

**Summary** (optional) — use `SUMIFS` formulas to track spending per category:
```
=SUMIFS(Transactions!C:C, Transactions!F:F, A2, Transactions!D:D, "debit")
```

## Usage

```sh
bun run sync
```

Fetches all transaction emails since the last sync (defaults to the past 7 days on first run), categorizes them, and appends new rows to the sheet. Duplicates are automatically skipped.

The last sync timestamp is saved to `.last-sync` after each successful write. Delete this file to re-sync from scratch.

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
  auth/
    google.ts       # OAuth2 token refresh
  gmail/
    client.ts       # Gmail API: list and fetch messages
  sheets/
    client.ts       # Sheets API: read ranges, append rows
  parsers/
    registry.ts     # Bank parser registry
    moniepoint.ts   # Moniepoint email parser
  categorizer.ts    # Loads category rules from sheet, matches transactions
scripts/
  setup-auth.ts     # One-time OAuth2 setup flow
```

## GitHub Actions (coming soon)

The sync can be automated via a scheduled GitHub Actions workflow. Store all `.env` values as repository secrets and run `bun run sync` on a cron schedule.
