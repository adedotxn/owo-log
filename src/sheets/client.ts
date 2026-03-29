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
