import { describe, it, expect } from "bun:test";
import { categorize } from "../src/categorizer.ts";
import type { CategoryRule, Transaction } from "../src/types.ts";

const rules: CategoryRule[] = [
  { category: "Groceries", keywords: ["shoprite", "spar", "justrite"] },
  { category: "Transport", keywords: ["uber", "bolt"] },
  { category: "Food Delivery", keywords: ["foodexpress", "captain cook"] },
];

function makeTx(narration: string, direction: "debit" | "credit" = "debit"): Transaction {
  return {
    date: "01/05/2026",
    time: "10:00:00",
    amount: 1000,
    balance: 50000,
    narration,
    bank: "Moniepoint",
    direction,
  };
}

describe("categorize", () => {
  it("matches keyword case-insensitively", () => {
    const result = categorize(makeTx("POS PURCHASE SHOPRITE"), rules);
    expect(result.category).toBe("Groceries");
    expect(result.flagged).toBe(false);
  });

  it("matches partial narration substring", () => {
    const result = categorize(makeTx("PAYMENT TO UBER TECHNOLOGIES"), rules);
    expect(result.category).toBe("Transport");
    expect(result.flagged).toBe(false);
  });

  it("marks unmatched transaction as Uncategorized and flagged", () => {
    const result = categorize(makeTx("UNKNOWN MERCHANT XYZ"), rules);
    expect(result.category).toBe("Uncategorized");
    expect(result.flagged).toBe(true);
  });

  it("returns first matching category when multiple could match", () => {
    const overlapping: CategoryRule[] = [
      { category: "First", keywords: ["foo"] },
      { category: "Second", keywords: ["foo"] },
    ];
    const result = categorize(makeTx("foobar"), overlapping);
    expect(result.category).toBe("First");
  });

  it("preserves all original transaction fields", () => {
    const tx = makeTx("POS SPAR MART", "credit");
    const result = categorize(tx, rules);
    expect(result.date).toBe(tx.date);
    expect(result.time).toBe(tx.time);
    expect(result.amount).toBe(tx.amount);
    expect(result.balance).toBe(tx.balance);
    expect(result.bank).toBe(tx.bank);
    expect(result.direction).toBe("credit");
  });

  it("handles empty rules list by returning Uncategorized", () => {
    const result = categorize(makeTx("SHOPRITE"), []);
    expect(result.category).toBe("Uncategorized");
    expect(result.flagged).toBe(true);
  });
});
