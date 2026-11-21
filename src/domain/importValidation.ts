// Pure validation for a parsed spreadsheet. No database, no Express, so it is easy to test and explain.
// Input: rows already parsed from CSV (header names as keys). Output: clean candidates OR a full error list.

export interface ImportError {
  row: number; // spreadsheet row number: header is row 1, first data row is row 2
  column: string;
  message: string;
}

export interface CleanCandidate {
  name: string;
  phone: string; // E.164, e.g. +919876543210
}

export interface ValidationResult {
  candidates: CleanCandidate[];
  errors: ImportError[];
}

export const MAX_ROWS = 500;
const REQUIRED_COLUMNS = ["name", "phone"];

// Accepts +<country><number>, a 10-digit Indian mobile, or 91 + 10-digit mobile. Returns null if invalid.
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^91[6-9]\d{9}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

export function validateRows(rows: Record<string, string>[]): ValidationResult {
  const errors: ImportError[] = [];
  const candidates: CleanCandidate[] = [];

  if (rows.length === 0) {
    return { candidates, errors: [{ row: 1, column: "file", message: "File has no data rows" }] };
  }
  if (rows.length > MAX_ROWS) {
    return { candidates, errors: [{ row: 1, column: "file", message: `Too many rows (max ${MAX_ROWS})` }] };
  }

  // Check headers once, using the first row's keys.
  const headers = Object.keys(rows[0] ?? {}).map((h) => h.trim().toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) errors.push({ row: 1, column: col, message: `Missing required column "${col}"` });
  }
  if (errors.length > 0) return { candidates, errors };

  const seenPhones = new Map<string, number>(); // phone -> first row it appeared in

  rows.forEach((raw, index) => {
    const row = index + 2;
    // Lower-case the keys so "Name" and "name" both work.
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[k.trim().toLowerCase()] = (v ?? "").trim();

    const rowErrors: ImportError[] = [];

    if (!r.name) rowErrors.push({ row, column: "name", message: "Name is required" });
    else if (r.name.length > 100) rowErrors.push({ row, column: "name", message: "Name is longer than 100 characters" });

    let phone: string | null = null;
    if (!r.phone) rowErrors.push({ row, column: "phone", message: "Phone is required" });
    else {
      phone = normalizePhone(r.phone);
      if (!phone) rowErrors.push({ row, column: "phone", message: `"${r.phone}" is not a valid phone number` });
    }

    if (phone) {
      const firstRow = seenPhones.get(phone);
      if (firstRow !== undefined) {
        rowErrors.push({ row, column: "phone", message: `Duplicate of row ${firstRow} in this file` });
      } else {
        seenPhones.set(phone, row);
      }
    }

    if (rowErrors.length > 0) errors.push(...rowErrors);
    else candidates.push({ name: r.name as string, phone: phone as string });
  });

  // All-or-nothing: if there is any error, nothing is returned as promotable.
  return errors.length > 0 ? { candidates: [], errors } : { candidates, errors };
}