// Register bank parsers (side-effect imports — each self-registers)
import "./parsers/moniepoint.ts";

import { listTransactionEmails, getMessageBody } from "./gmail/client.ts";
import { parseEmail } from "./parsers/registry.ts";
import { loadCategoryRules, categorize } from "./categorizer.ts";
import { readRange, appendRows, ensureTabs, applyPeriodGrouping, listSheetTabs } from "./sheets/client.ts";
import { writePeriodSummary } from "./summary.ts";
import { spinner, header, info, warn, done, fmtMs } from "./ui.ts";
import type { CategorizedTransaction } from "./types.ts";

const LAST_SYNC_FILE    = ".last-sync";
const TRANSACTIONS_RANGE = "Transactions!A:J";
const COL_COUNT          = 10;

function parseDateArg(value: string): number {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) throw new Error(`Invalid date "${value}" — expected DD/MM/YYYY`);
  return Math.floor(new Date(Date.UTC(year, month - 1, day)).getTime() / 1000);
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function parseArgs(): { start?: string; end?: string; week: boolean; today: boolean } {
  const args = process.argv.slice(2);
  let start: string | undefined;
  let end: string | undefined;
  let week = false;
  let today = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1]) start = args[++i];
    else if (args[i] === "--end" && args[i + 1]) end = args[++i];
    else if (args[i] === "--week") week = true;
    else if (args[i] === "--today") today = true;
  }
  return { start, end, week, today };
}

// Local-time helpers — week/today boundaries follow the user's clock, not UTC.
function localDateStr(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getWeekRange(): { afterTs: number; beforeTs: number; periodLabel: string } {
  const now = new Date();
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay(), 0, 0, 0, 0);
  const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 6, 0, 0, 0, 0);
  const nextSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7, 0, 0, 0, 0);
  return {
    afterTs: Math.floor(sunday.getTime() / 1000),
    beforeTs: Math.floor(nextSunday.getTime() / 1000),
    periodLabel: `week ${localDateStr(sunday)} - ${localDateStr(saturday)}`,
  };
}

function getTodayRange(): { afterTs: number; beforeTs: number; periodLabel: string } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return {
    afterTs: Math.floor(startOfDay.getTime() / 1000),
    beforeTs: Math.floor(endOfDay.getTime() / 1000),
    periodLabel: `today ${localDateStr(startOfDay)}`,
  };
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

function formatRow(tx: CategorizedTransaction, period: string): (string | number)[] {
  return [
    tx.date,
    tx.time,
    tx.amount,      // number — stored as numeric cell so SUMIFS can aggregate it
    tx.direction,
    tx.narration,
    tx.category,
    tx.balance,     // number
    tx.bank,
    tx.flagged ? "YES" : "",
    period,
  ];
}

async function main(): Promise<void> {
  const syncStart = Date.now();

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("SHEET_ID is not set in .env");

  const { start: startArg, end: endArg, week: weekFlag, today: todayFlag } = parseArgs();
  const isRangeSync = !!(startArg || weekFlag || todayFlag);

  let afterTs: number;
  let beforeTs: number | undefined;
  let periodLabel: string;
  let displayMode: "range" | "week" | "today" | "since";

  if (weekFlag) {
    ({ afterTs, beforeTs, periodLabel } = getWeekRange());
    displayMode = "week";
  } else if (todayFlag) {
    ({ afterTs, beforeTs, periodLabel } = getTodayRange());
    displayMode = "today";
  } else if (startArg) {
    afterTs = parseDateArg(startArg);
    if (endArg) {
      beforeTs = parseDateArg(endArg) + 86400;
    } else {
      const now = new Date();
      beforeTs = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000);
    }
    periodLabel = `${formatDateLabel(afterTs)} - ${formatDateLabel(beforeTs - 86400)}`;
    displayMode = "range";
  } else {
    afterTs = parseInt(await readLastSync());
    beforeTs = undefined;
    periodLabel = `after:${formatDateLabel(afterTs)}`;
    displayMode = "since";
  }

  header("owo-log");
  if (displayMode === "week") info("week", periodLabel.replace("week ", ""));
  else if (displayMode === "today") info("today", periodLabel.replace("today ", ""));
  else if (displayMode === "range") info("range", periodLabel);
  else info("since", new Date(afterTs * 1000).toLocaleDateString());
  process.stdout.write("\n");

  // Ensure sheet tabs exist
  let t = Date.now();
  spinner.start("verifying sheet tabs");
  const created = await ensureTabs(sheetId, ["Transactions", "Categories", "Summary"]);
  spinner.succeed(
    created.length > 0 ? `created tabs: ${created.join(", ")}` : "sheet tabs ready",
    Date.now() - t
  );

  // Fetch email list
  t = Date.now();
  spinner.start("fetching emails");
  const messageIds = await listTransactionEmails(String(afterTs), beforeTs ? String(beforeTs) : undefined);

  if (messageIds.length === 0) {
    spinner.succeed("no emails found", Date.now() - t);
    info("nothing to sync");
    return;
  }
  spinner.succeed(`found ${messageIds.length} email(s)`, Date.now() - t);

  // Load category rules
  t = Date.now();
  spinner.start("loading category rules");
  const categoryRules = await loadCategoryRules(sheetId);
  spinner.succeed(`${categoryRules.length} category rule(s) loaded`, Date.now() - t);

  // Fetch and parse each email
  const transactions: CategorizedTransaction[] = [];
  const parseFailures: string[] = [];

  t = Date.now();
  spinner.start("parsing emails");
  for (let i = 0; i < messageIds.length; i++) {
    spinner.progress(i + 1, messageIds.length);
    const id = messageIds[i];
    let subject: string;
    let body: string;
    try {
      ({ subject, body } = await getMessageBody(id));
    } catch {
      parseFailures.push(id);
      continue;
    }
    const tx = parseEmail(subject, body);
    if (!tx) { parseFailures.push(id); continue; }
    transactions.push(categorize(tx, categoryRules));
  }

  spinner.succeed(
    parseFailures.length > 0
      ? `parsed ${transactions.length}/${messageIds.length}  ·  ${parseFailures.length} unrecognized`
      : `parsed ${transactions.length} transaction(s)`,
    Date.now() - t
  );

  if (parseFailures.length > 0) {
    warn(`unrecognized email IDs: ${parseFailures.join(", ")}`);
  }

  if (transactions.length === 0) {
    info("no transactions parsed");
    if (!isRangeSync) await writeLastSync();
    return;
  }

  // Dedup against existing sheet rows
  t = Date.now();
  spinner.start("checking for duplicates");
  let existingRows: string[][] = [];
  try {
    existingRows = await readRange(sheetId, "Transactions!A2:J501", "UNFORMATTED_VALUE");
  } catch {
    spinner.warn("could not read existing rows — skipping dedup check");
  }

  const newTransactions = deduplicateAgainstExisting(transactions, existingRows, periodLabel, isRangeSync);
  const skipped = transactions.length - newTransactions.length;

  if (skipped > 0) {
    spinner.succeed(`${skipped} duplicate(s) skipped`, Date.now() - t);
  } else {
    spinner.succeed("no duplicates found", Date.now() - t);
  }

  if (newTransactions.length === 0) {
    info("all transactions already in sheet");
    if (!isRangeSync) await writeLastSync();
    return;
  }

  // Write to Transactions tab
  t = Date.now();
  spinner.start("writing to sheet");
  const tabs = await listSheetTabs(sheetId);
  const transactionsTab = tabs.find((tab) => tab.title === "Transactions");

  const separator = [`── ${periodLabel} ──`, ...Array(COL_COUNT - 1).fill("")];
  const { startRow: separatorRow } = await appendRows(sheetId, TRANSACTIONS_RANGE, [separator]);

  const rows = newTransactions.map((tx) => formatRow(tx, periodLabel));
  const { startRow: txStartRow, endRow: txEndRow } = await appendRows(sheetId, TRANSACTIONS_RANGE, rows);

  if (transactionsTab) {
    await applyPeriodGrouping(sheetId, transactionsTab.sheetId, separatorRow, txStartRow, txEndRow);
  }
  spinner.succeed(`wrote ${newTransactions.length} row(s)`, Date.now() - t);

  // Write per-period summary
  const summaryTab = tabs.find((tab) => tab.title === "Summary");
  if (summaryTab) {
    t = Date.now();
    spinner.start("updating summary");
    await writePeriodSummary(sheetId, summaryTab.sheetId, periodLabel, categoryRules);
    spinner.succeed("summary updated", Date.now() - t);
  }

  if (!isRangeSync) await writeLastSync();

  const flagged = newTransactions.filter((tx) => tx.flagged).length;
  done(
    flagged > 0
      ? `${newTransactions.length} synced  ·  ${flagged} flagged`
      : `${newTransactions.length} synced`,
    Date.now() - syncStart
  );
}

main().catch((err) => {
  spinner.fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
