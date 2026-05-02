import type { CategorizedTransaction } from "./types.ts";

export function parseDateArg(value: string): number {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) throw new Error(`Invalid date "${value}" — expected DD/MM/YYYY`);
  return Math.floor(new Date(Date.UTC(year, month - 1, day)).getTime() / 1000);
}

export function formatDateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function localDateStr(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function getWeekRange(): { afterTs: number; beforeTs: number; periodLabel: string } {
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

export function getTodayRange(): { afterTs: number; beforeTs: number; periodLabel: string } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return {
    afterTs: Math.floor(startOfDay.getTime() / 1000),
    beforeTs: Math.floor(endOfDay.getTime() / 1000),
    periodLabel: `today ${localDateStr(startOfDay)}`,
  };
}

export function deduplicateAgainstExisting(
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
