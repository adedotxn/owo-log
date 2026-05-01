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

export async function readRange(sheetId: string, range: string): Promise<string[][]> {
  const res = await sheetsFetch(
    `/${sheetId}/values/${encodeURIComponent(range)}`
  );
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

export async function appendRows(
  sheetId: string,
  range: string,
  rows: string[][]
): Promise<void> {
  await sheetsFetch(
    `/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    }
  );
}

export async function listSheetTabs(sheetId: string): Promise<string[]> {
  const res = await sheetsFetch(`/${sheetId}?fields=sheets.properties.title`);
  const data = (await res.json()) as { sheets: { properties: { title: string } }[] };
  return data.sheets.map((s) => s.properties.title);
}

export async function createTab(sheetId: string, title: string): Promise<void> {
  await sheetsFetch(`/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

export const TAB_HEADERS: Record<string, string[]> = {
  Transactions: ["Date", "Time", "Amount", "Direction", "Narration", "Category", "Balance", "Bank", "Flagged", "Period"],
  Categories: ["Category", "Keywords"],
};

export async function ensureTabs(sheetId: string, tabs: string[]): Promise<string[]> {
  const existing = await listSheetTabs(sheetId);
  const created: string[] = [];
  for (const tab of tabs) {
    if (!existing.includes(tab)) {
      await createTab(sheetId, tab);
      const headers = TAB_HEADERS[tab];
      if (headers) {
        await appendRows(sheetId, `${tab}!A1`, [headers]);
      }
      created.push(tab);
    }
  }
  return created;
}
