import { describe, it, expect } from "bun:test";
import { parseMoniepoint } from "../../src/parsers/moniepoint.ts";

const DEBIT_SUBJECT = "Debit Alert";
const CREDIT_SUBJECT = "Credit Alert";

function makeBody({
  label = "Debit Amount",
  amount = "4,500.00",
  balance = "120,000.00",
  date = "30/04/2026",
  time = "14:23:01",
  narration = "POS PURCHASE SHOPRITE",
}: {
  label?: string;
  amount?: string;
  balance?: string;
  date?: string;
  time?: string;
  narration?: string;
} = {}): string {
  return `
${label}

${amount}

Account Balance:
N ${balance}

Date & Time:
${date} | ${time}

Narration:
${narration}
`;
}

describe("parseMoniepoint", () => {
  it("parses a debit alert correctly", () => {
    const result = parseMoniepoint(DEBIT_SUBJECT, makeBody());
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(4500);
    expect(result!.balance).toBe(120000);
    expect(result!.date).toBe("30/04/2026");
    expect(result!.time).toBe("14:23:01");
    expect(result!.narration).toBe("POS PURCHASE SHOPRITE");
    expect(result!.direction).toBe("debit");
    expect(result!.bank).toBe("Moniepoint");
  });

  it("parses a credit alert correctly", () => {
    const body = makeBody({ label: "Credit Amount", amount: "15,000.00", narration: "TRANSFER FROM JOHN DOE" });
    const result = parseMoniepoint(CREDIT_SUBJECT, body);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("credit");
    expect(result!.amount).toBe(15000);
    expect(result!.narration).toBe("TRANSFER FROM JOHN DOE");
  });

  it("returns null for unrecognized subject", () => {
    expect(parseMoniepoint("Account Statement", makeBody())).toBeNull();
  });

  it("returns null when Account Balance is missing", () => {
    const body = makeBody().replace("Account Balance:", "Something Else:");
    expect(parseMoniepoint(DEBIT_SUBJECT, body)).toBeNull();
  });

  it("returns null when amount field is missing", () => {
    const body = makeBody().replace("Debit Amount", "Other Field");
    expect(parseMoniepoint(DEBIT_SUBJECT, body)).toBeNull();
  });

  it("returns null when datetime is missing", () => {
    const body = makeBody().replace("Date & Time:", "Timestamp:");
    expect(parseMoniepoint(DEBIT_SUBJECT, body)).toBeNull();
  });

  it("returns null when narration is missing", () => {
    const body = makeBody().replace("Narration:", "Description:");
    expect(parseMoniepoint(DEBIT_SUBJECT, body)).toBeNull();
  });

  it("strips commas from amounts", () => {
    const result = parseMoniepoint(DEBIT_SUBJECT, makeBody({ amount: "1,234,567.89", balance: "9,000,000.00" }));
    expect(result!.amount).toBe(1234567.89);
    expect(result!.balance).toBe(9000000);
  });

  it("is case-insensitive on subject", () => {
    expect(parseMoniepoint("debit alert", makeBody())).not.toBeNull();
    expect(parseMoniepoint("CREDIT ALERT", makeBody({ label: "Credit Amount" }))).not.toBeNull();
  });
});
