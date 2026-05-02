import { describe, it, expect } from "bun:test";
import { parseUpdatedRange } from "../src/sheets/client.ts";

describe("parseUpdatedRange", () => {
  it("parses a standard range string", () => {
    const result = parseUpdatedRange("Transactions!A11:J15");
    expect(result.startRow).toBe(10); // 1-based 11 → 0-based 10
    expect(result.endRow).toBe(15);   // endRow is exclusive, matches the 1-based end
  });

  it("handles single-row ranges", () => {
    const result = parseUpdatedRange("Sheet1!A5:J5");
    expect(result.startRow).toBe(4);
    expect(result.endRow).toBe(5);
  });

  it("handles row 1 (header row)", () => {
    const result = parseUpdatedRange("Summary!A1:C1");
    expect(result.startRow).toBe(0);
    expect(result.endRow).toBe(1);
  });

  it("throws on unparseable range", () => {
    expect(() => parseUpdatedRange("Transactions!A:J")).toThrow("Could not parse updated range");
    expect(() => parseUpdatedRange("invalid")).toThrow("Could not parse updated range");
  });
});
