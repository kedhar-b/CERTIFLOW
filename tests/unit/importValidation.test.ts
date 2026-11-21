import { describe, it, expect } from "vitest";
import { validateRows, normalizePhone } from "../../src/domain/importValidation";

describe("M20 spreadsheet import validation", () => {
  it("M20 returns exact row and column errors for 3 bad rows and promotes nothing", () => {
    const rows = [
      { name: "Ravi Kumar", phone: "9876543210" }, // row 2 good
      { name: "", phone: "9876543211" }, // row 3 missing name
      { name: "Asha", phone: "12345" }, // row 4 bad phone
      { name: "Dup", phone: "9876543210" }, // row 5 duplicate of row 2
    ];
    const result = validateRows(rows);
    expect(result.candidates).toEqual([]); // all-or-nothing
    expect(result.errors).toEqual([
      { row: 3, column: "name", message: "Name is required" },
      { row: 4, column: "phone", message: '"12345" is not a valid phone number' },
      { row: 5, column: "phone", message: "Duplicate of row 2 in this file" },
    ]);
  });

  it("M20 accepts a clean file and normalises phones to E.164", () => {
    const result = validateRows([
      { name: "Ravi Kumar", phone: "98765 43210" },
      { name: "Asha", phone: "+919876543211" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.candidates.map((c) => c.phone)).toEqual(["+919876543210", "+919876543211"]);
  });

  it("M20 reports a missing column once, on the header row", () => {
    const result = validateRows([{ name: "Ravi" }]);
    expect(result.errors).toEqual([{ row: 1, column: "phone", message: 'Missing required column "phone"' }]);
  });

  it("M20 normalizePhone rejects junk", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("5876543210")).toBeNull(); // Indian mobiles start 6-9
  });
});