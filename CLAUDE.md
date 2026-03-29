# owo-log

Personal finance automation tool. Fetches Moniepoint debit/credit alert emails from Gmail, categorizes transactions using a Google Sheet-driven keyword map, and appends structured rows to the same sheet.

**Runtime:** Bun. Use `bun` instead of `node`, `bun install` instead of `npm install`, `bun run` instead of `npm run`. Bun loads `.env` automatically — do not use dotenv. Prefer `Bun.file` over `node:fs`.

## Commands

```sh
bun run sync    # fetch, parse, categorize, write to sheet
bun run setup   # one-time OAuth2 flow to get a refresh token
```

## Architecture

```
Gmail API → parser registry → categorizer → Sheets API
```

1. `src/index.ts` — orchestrator. Reads `.last-sync` for the cutoff date, drives the full pipeline, writes `.last-sync` only after a successful sheet append.
2. `src/auth/google.ts` — OAuth2 token refresh via `fetch`. In-memory cache with expiry. Single token covers both Gmail and Sheets.
3. `src/gmail/client.ts` — lists emails matching `from:moniepoint.com (subject:"Debit alert" OR subject:"Credit alert")`, fetches full message bodies, decodes base64url MIME parts.
4. `src/parsers/registry.ts` — `Map<string, EmailParser>`. Each parser self-registers at import time. `parseEmail()` iterates all parsers and returns the first non-null result.
5. `src/parsers/moniepoint.ts` — regex parser for Moniepoint's plain-text email format. Label and value are on separate lines (e.g. `Debit Amount\n\n500.00`). Returns `null` if subject or required fields don't match.
6. `src/categorizer.ts` — reads the **Categories** tab from the sheet at runtime (`Category | Keywords` columns), lowercases and matches narration substrings. No match → `Uncategorized`, `flagged: true`.
7. `src/sheets/client.ts` — `readRange` and `appendRows` via Sheets REST API v4.

## Key types (`src/types.ts`)

```ts
interface Transaction {
  date: string; time: string; amount: number; narration: string;
  balance: number; bank: string; direction: "debit" | "credit";
}
interface CategorizedTransaction extends Transaction {
  category: string; flagged: boolean;
}
type EmailParser = (subject: string, body: string) => Transaction | null;
```

## Google Sheet structure

- **Transactions** tab — columns A–I: `Date | Time | Amount | Direction | Narration | Category | Balance | Bank | Flagged`
- **Categories** tab — columns A–B: `Category | Keywords` (keywords are comma-separated, matched case-insensitively)
- **Summary** tab (optional) — use `SUMIFS(Transactions!C:C, Transactions!F:F, A2, Transactions!D:D, "debit")` per category row

## Environment variables (`.env`)

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth2 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret |
| `GOOGLE_REFRESH_TOKEN` | Obtained by running `bun run setup` |
| `SHEET_ID` | ID from the Google Sheet URL (`/d/{SHEET_ID}/edit`) |

## Adding a new bank parser

1. Create `src/parsers/<bank>.ts` — implement `EmailParser`, call `registerParser("<bank>", parseFn)` at module scope
2. Add `import "./parsers/<bank>.ts"` to `src/index.ts`

The parser receives the raw email subject and decoded plain-text body. Return `null` if the email isn't from this bank.

## Zero runtime dependencies

All Google API calls use native `fetch`. No SDK packages. Auth, Gmail, and Sheets are plain REST with JSON.
