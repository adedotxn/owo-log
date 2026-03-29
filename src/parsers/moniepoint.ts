import type { Transaction } from "../types.ts";
import { registerParser } from "./registry.ts";

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ""));
}

function parseMoniepoint(subject: string, body: string): Transaction | null {
  const subjectLower = subject.toLowerCase();
  if (!subjectLower.includes("debit alert") && !subjectLower.includes("credit alert")) return null;
  if (!body.includes("Account Balance")) return null;

  const direction: "debit" | "credit" = subjectLower.includes("debit") ? "debit" : "credit";
  const label = direction === "debit" ? "Debit Amount" : "Credit Amount";

  // Plain text body has label on one line, value on a subsequent line
  // e.g. "Debit Amount\n\n500.00"
  const amountMatch = body.match(new RegExp(`${label}\\s*\\n+\\s*([\\d,]+\\.\\d{2})`, "i"));
  const amountRaw = amountMatch?.[1];
  if (!amountRaw) return null;

  const balanceMatch = body.match(/Account Balance:\s*\n+\s*N\s*([\d,]+\.\d{2})/i);
  const dateTimeMatch = body.match(/Date & Time:\s*\n+\s*(.+)/i);
  const narrationMatch = body.match(/Narration:\s*\n+\s*(.+)/i);

  if (!balanceMatch || !dateTimeMatch || !narrationMatch) return null;

  const dateTimeParts = dateTimeMatch[1]!.split("|").map((s) => s.trim());
  const date = dateTimeParts[0] ?? "";
  const time = dateTimeParts[1] ?? "";

  return {
    date,
    time,
    amount: parseAmount(amountRaw),
    balance: parseAmount(balanceMatch[1]!),
    narration: narrationMatch[1]!.trim(),
    bank: "Moniepoint",
    direction,
  };
}

registerParser("moniepoint", parseMoniepoint);

export { parseMoniepoint };
