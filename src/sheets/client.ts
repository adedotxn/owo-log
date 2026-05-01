import { getAccessToken } from "../auth/google.ts";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function sheetsFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API error (${res.status}) at ${path}: ${body}`);
  }
  return res;
}

// valueRenderOption="UNFORMATTED_VALUE" returns raw numbers/booleans; all cells are stringified
// so the return type is always string[][] regardless of option.
export async function readRange(
  sheetId: string,
  range: string,
  valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" = "FORMATTED_VALUE"
): Promise<string[][]> {
  const res = await sheetsFetch(
    `/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${valueRenderOption}`
  );
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
}

// Returns 0-based { startRow, endRow } where endRow is exclusive (matches Sheets API index convention).
export async function appendRows(
  sheetId: string,
  range: string,
  rows: (string | number)[][],
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW"
): Promise<{ startRow: number; endRow: number }> {
  const res = await sheetsFetch(
    `/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    }
  );
  const data = (await res.json()) as { updates: { updatedRange: string } };
  return parseUpdatedRange(data.updates.updatedRange);
}

// "Sheet!A11:J15" → startRow=10, endRow=15 (0-based, endRow exclusive)
function parseUpdatedRange(range: string): { startRow: number; endRow: number } {
  const match = range.match(/[A-Z]+(\d+):[A-Z]+(\d+)/);
  if (!match) throw new Error(`Could not parse updated range: ${range}`);
  return {
    startRow: parseInt(match[1]) - 1,
    endRow: parseInt(match[2]),
  };
}

export interface SheetTab {
  title: string;
  sheetId: number;
}

export async function listSheetTabs(sheetId: string): Promise<SheetTab[]> {
  const res = await sheetsFetch(`/${sheetId}?fields=sheets.properties`);
  const data = (await res.json()) as { sheets: { properties: { title: string; sheetId: number } }[] };
  return data.sheets.map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
}

export async function createTab(sheetId: string, title: string): Promise<void> {
  await sheetsFetch(`/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

// Styles the separator row and groups the transaction rows below it.
// separatorRow: 0-based index of the separator row.
// txStartRow/txEndRow: 0-based indices of the transaction rows (endRow exclusive).
export async function applyPeriodGrouping(
  sheetId: string,
  tabSheetId: number,
  separatorRow: number,
  txStartRow: number,
  txEndRow: number
): Promise<void> {
  // Formatting and grouping are separate calls so a grouping failure can't prevent the colour from applying.
  await batchUpdate(sheetId, [
    {
      repeatCell: {
        range: { sheetId: tabSheetId, startRowIndex: separatorRow, endRowIndex: separatorRow + 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.067, green: 0.337, blue: 0.573 } },
            textFormat: { bold: true, fontSize: 10, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat",
      },
    },
  ]);

  await batchUpdate(sheetId, [
    {
      addDimensionGroup: {
        range: { sheetId: tabSheetId, dimension: "ROWS", startIndex: txStartRow, endIndex: txEndRow },
      },
    },
  ]);
}

export const TAB_HEADERS: Record<string, string[]> = {
  Transactions: ["Date", "Time", "Amount", "Direction", "Narration", "Category", "Balance", "Bank", "Flagged", "Period"],
  Categories: ["Category", "Keywords"],
  Summary: [],
};

export async function ensureTabs(sheetId: string, tabs: string[]): Promise<string[]> {
  const existing = await listSheetTabs(sheetId);
  const existingTitles = existing.map((t) => t.title);
  const created: string[] = [];
  for (const tab of tabs) {
    if (!existingTitles.includes(tab)) {
      await createTab(sheetId, tab);
      const headers = TAB_HEADERS[tab];
      if (headers && headers.length > 0) {
        await appendRows(sheetId, `${tab}!A1`, [headers]);
      }
      created.push(tab);
    }
  }
  return created;
}

export async function batchUpdate(sheetId: string, requests: unknown[]): Promise<void> {
  await sheetsFetch(`/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}
