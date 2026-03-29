import type { EmailParser, Transaction } from "../types.ts";

const parsers = new Map<string, EmailParser>();

export function registerParser(bank: string, parser: EmailParser): void {
  parsers.set(bank.toLowerCase(), parser);
}

export function parseEmail(subject: string, body: string): Transaction | null {
  for (const parser of parsers.values()) {
    const result = parser(subject, body);
    if (result !== null) return result;
  }
  return null;
}
