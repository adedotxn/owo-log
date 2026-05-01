import { readRange, appendRows, batchUpdate } from "./sheets/client.ts";
import type { CategoryRule } from "./types.ts";

const SUMMARY_RANGE = "Summary!A:C";

// Blue header matching the Transactions separator style
const HEADER_COLOR = { red: 0.067, green: 0.337, blue: 0.573 };
const SUBHEADER_COLOR = { red: 0.93, green: 0.93, blue: 0.93 };

function sumifs(category: string, direction: "debit" | "credit", period: string): string {
  return `=IFERROR(SUMIFS(Transactions!C:C,Transactions!F:F,"${category}",Transactions!D:D,"${direction}",Transactions!J:J,"${period}"),0)`;
}

function totalSumifs(direction: "debit" | "credit", period: string): string {
  return `=IFERROR(SUMIFS(Transactions!C:C,Transactions!D:D,"${direction}",Transactions!J:J,"${period}"),0)`;
}

export async function writePeriodSummary(
  sheetId: string,
  summaryTabId: number,
  periodLabel: string,
  categoryRules: CategoryRule[]
): Promise<void> {
  // Skip if this period already has a summary block
  const existingCol = await readRange(sheetId, "Summary!A:A");
  const headerText = `── ${periodLabel} ──`;
  if (existingCol.some((row) => row[0] === headerText)) return;

  const categories = categoryRules.map((r) => r.category);

  const allRows = [
    [headerText, "", ""],
    ["Category", "Debits (₦)", "Credits (₦)"],
    ...categories.map((cat) => [cat, sumifs(cat, "debit", periodLabel), sumifs(cat, "credit", periodLabel)]),
    ["Uncategorized", sumifs("Uncategorized", "debit", periodLabel), sumifs("Uncategorized", "credit", periodLabel)],
    ["TOTAL", totalSumifs("debit", periodLabel), totalSumifs("credit", periodLabel)],
    ["", "", ""],
  ];

  const { startRow } = await appendRows(sheetId, SUMMARY_RANGE, allRows, "USER_ENTERED");

  const headerIdx = startRow;
  const subheaderIdx = startRow + 1;
  const totalIdx = startRow + 2 + categories.length + 1; // +1 for Uncategorized row

  await batchUpdate(sheetId, [
    {
      repeatCell: {
        range: { sheetId: summaryTabId, startRowIndex: headerIdx, endRowIndex: headerIdx + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: HEADER_COLOR },
            textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
          },
        },
        fields: "userEnteredFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: summaryTabId, startRowIndex: subheaderIdx, endRowIndex: subheaderIdx + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: SUBHEADER_COLOR },
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat",
      },
    },
    {
      repeatCell: {
        range: { sheetId: summaryTabId, startRowIndex: totalIdx, endRowIndex: totalIdx + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat.textFormat",
      },
    },
  ]);
}
