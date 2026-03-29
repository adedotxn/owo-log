// Register bank parsers (side-effect imports — each self-registers)
import "./parsers/moniepoint.ts";

import { listTransactionEmails, getMessageBody } from "./gmail/client.ts";
import { parseEmail } from "./parsers/registry.ts";
import { loadCategoryRules, categorize } from "./categorizer.ts";
import { readRange, appendRows } from "./sheets/client.ts";
import type { CategorizedTransaction } from "./types.ts";

const LAST_SYNC_FILE = ".last-sync";
const TRANSACTIONS_RANGE = "Transactions!A:I";

function getDefaultAfterDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  // Gmail `after:` filter accepts Unix timestamps (seconds)
  return String(Math.floor(d.getTime() / 1000));
}

async function readLastSync(): Promise<string> {
  const file = Bun.file(LAST_SYNC_FILE);
  if (await file.exists()) {
    const content = (await file.text()).trim();
    if (content) return content;
  }
  return getDefaultAfterDate();
}

async function writeLastSync(): Promise<void> {
  await Bun.write(LAST_SYNC_FILE, String(Math.floor(Date.now() / 1000)));
}

function deduplicateAgainstExisting(
  transactions: CategorizedTransaction[],
  existingRows: string[][]
): CategorizedTransaction[] {
  // Build a set of dedup keys from existing sheet rows
  // Row format: [date, time, amount, direction, narration, category, balance, bank, flagged]
  const existingKeys = new Set(
    existingRows.map((row) => `${row[0]}|${row[1]}|${row[2]}|${row[4]}`)
  );

  return transactions.filter((tx) => {
    const key = `${tx.date}|${tx.time}|${tx.amount}|${tx.narration}`;
    return !existingKeys.has(key);
  });
}

function formatRow(tx: CategorizedTransaction): string[] {
  return [
    tx.date,
    tx.time,
    String(tx.amount),
    tx.direction,
    tx.narration,
    tx.category,
    String(tx.balance),
    tx.bank,
    tx.flagged ? "YES" : "",
  ];
}

async function main(): Promise<void> {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) {
    console.error("Error: SHEET_ID is not set in .env");
    process.exit(1);
  }

  console.log("owo-log: Starting sync...");

  const afterDate = await readLastSync();
  const afterDateReadable = new Date(parseInt(afterDate) * 1000).toLocaleString();
  console.log(`Fetching emails after: ${afterDateReadable}`);

  const messageIds = await listTransactionEmails(afterDate);
  console.log(`Found ${messageIds.length} transaction email(s)`);

  if (messageIds.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  // Fetch and parse emails
  const transactions: CategorizedTransaction[] = [];
  const parseFailures: string[] = [];
  const fetchFailures: string[] = [];

  const categoryRules = await loadCategoryRules(sheetId);
  console.log(`Loaded ${categoryRules.length} category rule(s) from sheet`);

  for (const id of messageIds) {
    let subject: string;
    let body: string;

    try {
      ({ subject, body } = await getMessageBody(id));
    } catch (err) {
      fetchFailures.push(id);
      console.error(`  Failed to fetch message ${id}:`, err);
      continue;
    }

    const tx = parseEmail(subject, body);
    if (!tx) {
      parseFailures.push(id);
      continue;
    }

    transactions.push(categorize(tx, categoryRules));
  }

  if (parseFailures.length > 0) {
    console.warn(
      `  ${parseFailures.length} email(s) not recognized by any parser (new bank? check message IDs: ${parseFailures.join(", ")})`
    );
  }

  if (transactions.length === 0) {
    console.log("No transactions parsed.");
    await writeLastSync();
    return;
  }

  // Dedup against last 500 rows in the sheet
  let existingRows: string[][] = [];
  try {
    existingRows = await readRange(sheetId, "Transactions!A2:I501");
  } catch {
    console.warn("  Could not read existing rows for dedup — proceeding without dedup check");
  }

  const newTransactions = deduplicateAgainstExisting(transactions, existingRows);
  const skipped = transactions.length - newTransactions.length;

  if (skipped > 0) {
    console.log(`  Skipped ${skipped} duplicate(s)`);
  }

  if (newTransactions.length === 0) {
    console.log("All transactions already in sheet. Nothing to write.");
    await writeLastSync();
    return;
  }

  const rows = newTransactions.map(formatRow);
  await appendRows(sheetId, TRANSACTIONS_RANGE, rows);

  // Only update last-sync after a successful write
  await writeLastSync();

  const flagged = newTransactions.filter((t) => t.flagged).length;
  console.log(
    `\nDone! Synced ${newTransactions.length} transaction(s)` +
      (flagged > 0 ? ` (${flagged} flagged as Uncategorized — review your Categories tab)` : "")
  );
}

main().catch((err) => {
  console.error("\nSync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
