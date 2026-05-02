import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  parseDateArg,
  formatDateLabel,
  getWeekRange,
  getTodayRange,
  deduplicateAgainstExisting,
} from "../src/utils.ts";
import type { CategorizedTransaction } from "../src/types.ts";

function makeTx(overrides: Partial<CategorizedTransaction> = {}): CategorizedTransaction {
  return {
    date: "01/05/2026",
    time: "10:00:00",
    amount: 1000,
    balance: 50000,
    narration: "TEST NARRATION",
    bank: "Moniepoint",
    direction: "debit",
    category: "Groceries",
    flagged: false,
    ...overrides,
  };
}

describe("parseDateArg", () => {
  it("parses DD/MM/YYYY to a UTC unix timestamp", () => {
    const ts = parseDateArg("01/05/2026");
    const d = new Date(ts * 1000);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4); // May = 4
    expect(d.getUTCDate()).toBe(1);
  });

  it("throws on invalid format", () => {
    expect(() => parseDateArg("2026-05-01")).toThrow();
    expect(() => parseDateArg("")).toThrow();
  });
});

describe("formatDateLabel", () => {
  it("formats a UTC timestamp back to DD/MM/YYYY", () => {
    const ts = Math.floor(Date.UTC(2026, 4, 1) / 1000); // 2026-05-01
    expect(formatDateLabel(ts)).toBe("01/05/2026");
  });

  it("zero-pads day and month", () => {
    const ts = Math.floor(Date.UTC(2026, 0, 9) / 1000); // 2026-01-09
    expect(formatDateLabel(ts)).toBe("09/01/2026");
  });

  it("is the inverse of parseDateArg", () => {
    const original = "15/03/2026";
    expect(formatDateLabel(parseDateArg(original))).toBe(original);
  });
});

describe("getWeekRange", () => {
  it("returns Sunday as start and next Sunday as end", () => {
    const { afterTs, beforeTs, periodLabel } = getWeekRange();
    const start = new Date(afterTs * 1000);
    const end = new Date(beforeTs * 1000);
    expect(start.getDay()).toBe(0); // Sunday
    expect(end.getDay()).toBe(0);   // next Sunday
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(periodLabel).toMatch(/^week \d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("getTodayRange", () => {
  it("spans exactly 24 hours", () => {
    const { afterTs, beforeTs, periodLabel } = getTodayRange();
    expect(beforeTs - afterTs).toBe(86400);
    expect(periodLabel).toMatch(/^today \d{2}\/\d{2}\/\d{4}$/);
  });

  it("start is midnight local time", () => {
    const { afterTs } = getTodayRange();
    const d = new Date(afterTs * 1000);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe("deduplicateAgainstExisting", () => {
  const period = "01/05/2026 - 31/05/2026";

  const existingRow = (tx: CategorizedTransaction, p = period): string[] => [
    tx.date, tx.time, String(tx.amount), tx.direction, tx.narration,
    tx.category, String(tx.balance), tx.bank, tx.flagged ? "YES" : "", p,
  ];

  it("removes transactions already present in sheet (incremental mode)", () => {
    const tx = makeTx();
    const newTxs = deduplicateAgainstExisting([tx], [existingRow(tx)], period, false);
    expect(newTxs).toHaveLength(0);
  });

  it("keeps new transactions not present in sheet", () => {
    const tx = makeTx();
    const different = makeTx({ narration: "DIFFERENT NARRATION" });
    const newTxs = deduplicateAgainstExisting([tx, different], [existingRow(tx)], period, false);
    expect(newTxs).toHaveLength(1);
    expect(newTxs[0]!.narration).toBe("DIFFERENT NARRATION");
  });

  it("in range mode, only deduplicates within same period label", () => {
    const tx = makeTx();
    const otherPeriod = "01/04/2026 - 30/04/2026";
    // row is in a different period — should NOT be treated as duplicate
    const newTxs = deduplicateAgainstExisting([tx], [existingRow(tx, otherPeriod)], period, true);
    expect(newTxs).toHaveLength(1);
  });

  it("in range mode, deduplicates within the same period", () => {
    const tx = makeTx();
    const newTxs = deduplicateAgainstExisting([tx], [existingRow(tx, period)], period, true);
    expect(newTxs).toHaveLength(0);
  });

  it("deduplication key is date+time+amount+narration (not category)", () => {
    const tx = makeTx();
    const rowWithDiffCategory = existingRow({ ...tx, category: "Transport" });
    const newTxs = deduplicateAgainstExisting([tx], [rowWithDiffCategory], period, false);
    expect(newTxs).toHaveLength(0);
  });
});
