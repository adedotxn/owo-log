// Register bank parsers (side-effect imports — each self-registers)
import "./parsers/moniepoint.ts";

import { listTransactionEmails, getMessageBody } from "./gmail/client.ts";
import { parseEmail } from "./parsers/registry.ts";
import { loadCategoryRules, categorize } from "./categorizer.ts";
import { readRange, appendRows, ensureTabs, applyPeriodGrouping, listSheetTabs } from "./sheets/client.ts";
import { writePeriodSummary } from "./summary.ts";
import type { CategorizedTransaction } from "./types.ts";

const LAST_SYNC_FILE = ".last-sync";
const TRANSACTIONS_RANGE = "Transactions!A:J";

// Parse DD/MM/YYYY → Unix timestamp (seconds). Treats date as start-of-day UTC.
function parseDateArg(value: string): number {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) throw new Error(`Invalid date "${value}" — expected DD/MM/YYYY`);
  return Math.floor(new Date(Date.UTC(year, month - 1, day)).getTime() / 1000);
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function parseArgs(): { start?: string; end?: string } {
  const args = process.argv.slice(2);
  let start: string | undefined;
  let end: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1]) start = args[++i];
    else if (args[i] === "--end" && args[i + 1]) end = args[++i];
  }
  return { start, end };
}

function getDefaultAfterDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
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
  existingRows: string[][],
  period: string,
  isRangeSync: boolean
): CategorizedTransaction[] {
  // Range syncs: only dedup within the same period label (col J = index 9).
  // This lets two overlapping range queries each keep their own rows while
  // preventing the exact same range from being written twice.
  // Incremental syncs: dedup across all existing rows regardless of period.
  const rowsToCheck = isRangeSync
    ? existingRows.filter((row) => row[9] === period)
    : existingRows;

  const existingKeys = new Set(
    rowsToCheck.map((row) => `${row[0]}|${row[1]}|${row[2]}|${row[4]}`)
  );

  return transactions.filter((tx) => {
    const key = `${tx.date}|${tx.time}|${tx.amount}|${tx.narration}`;
    return !existingKeys.has(key);
  });
}

function formatRow(tx: CategorizedTransaction, period: string): string[] {
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
    period,
  ];
}

async function main(): Promise<void> {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) {
    console.error("Error: SHEET_ID is not set in .env");
    process.exit(1);
  }

  const { start: startArg, end: endArg } = parseArgs();
  const isRangeSync = !!startArg;

  let afterTs: number;
  let beforeTs: number | undefined;

  if (isRangeSync) {
    afterTs = parseDateArg(startArg!);
    // end defaults to today (inclusive: use start of next day as the before: timestamp)
    if (endArg) {
      const endDay = parseDateArg(endArg);
      beforeTs = endDay + 86400; // include the end date's transactions
    } else {
      const today = new Date();
      beforeTs = Math.floor(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)).getTime() / 1000);
    }
  } else {
    afterTs = parseInt(await readLastSync());
  }

  const periodLabel = isRangeSync
    ? `${formatDateLabel(afterTs)}–${formatDateLabel(beforeTs! - 86400)}`
    : `after:${formatDateLabel(afterTs)}`;

  console.log("owo-log: Starting sync...");
  if (isRangeSync) {
    console.log(`Range: ${periodLabel}`);
  } else {
    console.log(`Fetching emails after: ${new Date(afterTs * 1000).toLocaleString()}`);
  }

  const created = await ensureTabs(sheetId, ["Transactions", "Categories", "Summary"]);
  for (const tab of created) {
    console.log(`  Created missing tab: ${tab}`);
  }

  const messageIds = await listTransactionEmails(String(afterTs), beforeTs ? String(beforeTs) : undefined);
  console.log(`Found ${messageIds.length} transaction email(s)`);

  if (messageIds.length === 0) {
    console.log("Nothing to sync.");
    if (!isRangeSync) await writeLastSync();
    return;
  }

  const transactions: CategorizedTransaction[] = [];
  const parseFailures: string[] = [];

  const categoryRules = await loadCategoryRules(sheetId);
  console.log(`Loaded ${categoryRules.length} category rule(s) from sheet`);

  for (const id of messageIds) {
    let subject: string;
    let body: string;

    try {
      ({ subject, body } = await getMessageBody(id));
    } catch (err) {
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
    if (!isRangeSync) await writeLastSync();
    return;
  }

  // Dedup against last 500 rows in the sheet
  let existingRows: string[][] = [];
  try {
    existingRows = await readRange(sheetId, "Transactions!A2:J501");
  } catch {
    console.warn("  Could not read existing rows for dedup — proceeding without dedup check");
  }

  const newTransactions = deduplicateAgainstExisting(transactions, existingRows, periodLabel, isRangeSync);
  const skipped = transactions.length - newTransactions.length;

  if (skipped > 0) console.log(`  Skipped ${skipped} duplicate(s)`);

  if (newTransactions.length === 0) {
    console.log("All transactions already in sheet. Nothing to write.");
    if (!isRangeSync) await writeLastSync();
    return;
  }

  const tabs = await listSheetTabs(sheetId);
  const transactionsTab = tabs.find((t) => t.title === "Transactions");

  // Separator row — always visible even when the group is collapsed
  const COL_COUNT = 10;
  const separator = [`── ${periodLabel} ──`, ...Array(COL_COUNT - 1).fill("")];
  const { startRow: separatorRow } = await appendRows(sheetId, TRANSACTIONS_RANGE, [separator]);

  const rows = newTransactions.map((tx) => formatRow(tx, periodLabel));
  const { startRow: txStartRow, endRow: txEndRow } = await appendRows(sheetId, TRANSACTIONS_RANGE, rows);

  if (transactionsTab) {
    await applyPeriodGrouping(sheetId, transactionsTab.sheetId, separatorRow, txStartRow, txEndRow);
  }

  const summaryTab = tabs.find((t) => t.title === "Summary");
  if (summaryTab) {
    await writePeriodSummary(sheetId, summaryTab.sheetId, periodLabel, categoryRules);
    console.log("  Updated Summary tab");
  }

  if (!isRangeSync) await writeLastSync();

  const flagged = newTransactions.filter((t) => t.flagged).length;
  console.log(
    `\nDone! Synced ${newTransactions.length} transaction(s) [${periodLabel}]` +
      (flagged > 0 ? ` (${flagged} flagged as Uncategorized — review your Categories tab)` : "")
  );
}

main().catch((err) => {
  console.error("\nSync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
