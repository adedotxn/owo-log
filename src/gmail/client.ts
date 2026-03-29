import { getAccessToken } from "../auth/google.ts";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface MessageRef {
  id: string;
  threadId: string;
}

interface ListResponse {
  messages?: MessageRef[];
  nextPageToken?: string;
}

interface MessagePart {
  mimeType: string;
  body: { data?: string };
  parts?: MessagePart[];
}

interface MessageResponse {
  id: string;
  payload: MessagePart & {
    headers: Array<{ name: string; value: string }>;
  };
}

function decodeBase64Url(encoded: string): string {
  // Gmail uses base64url encoding (- instead of +, _ instead of /)
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractTextBody(part: MessagePart): string | null {
  if (part.mimeType === "text/plain" && part.body.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractTextBody(child);
      if (text) return text;
    }
  }
  return null;
}

async function gmailFetch(path: string): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API error (${res.status}) at ${path}: ${body}`);
  }
  return res;
}

export async function listTransactionEmails(afterDate?: string): Promise<string[]> {
  const query = afterDate
    ? `from:moniepoint.com (subject:"Debit alert" OR subject:"Credit alert") after:${afterDate}`
    : `from:moniepoint.com (subject:"Debit alert" OR subject:"Credit alert")`;

  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await gmailFetch(`/messages?${params}`);
    const data = (await res.json()) as ListResponse;

    if (data.messages) {
      ids.push(...data.messages.map((m) => m.id));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return ids;
}

export async function getMessageBody(
  messageId: string
): Promise<{ subject: string; body: string }> {
  const res = await gmailFetch(`/messages/${messageId}?format=full`);
  const data = (await res.json()) as MessageResponse;

  const subject =
    data.payload.headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";

  const body = extractTextBody(data.payload) ?? "";

  return { subject, body };
}
