import type { CategorizedTransaction, CategoryRule, Transaction } from "./types.ts";
import { readRange } from "./sheets/client.ts";

export async function loadCategoryRules(sheetId: string): Promise<CategoryRule[]> {
  // Categories tab: column A = category name, column B = comma-separated keywords
  const rows = await readRange(sheetId, "Categories!A2:B");

  return rows
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      category: row[0]!.trim(),
      keywords: row[1]!
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0),
    }));
}

export function categorize(
  tx: Transaction,
  rules: CategoryRule[]
): CategorizedTransaction {
  const narrationLower = tx.narration.toLowerCase();

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (narrationLower.includes(keyword)) {
        return { ...tx, category: rule.category, flagged: false };
      }
    }
  }

  return { ...tx, category: "Uncategorized", flagged: true };
}
