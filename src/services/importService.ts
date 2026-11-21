import { parse } from "csv-parse/sync";
import { validateRows, type ImportError } from "../domain/importValidation";
import { prisma } from "../lib/db";
import { conflict } from "../lib/errors";
import type { SessionUser } from "../types";
import { assertCentreOwner } from "./policy";
import { lockBatch, writeAudit } from "./txHelpers";

export type ImportResult = { ok: true; added: number } | { ok: false; errors: ImportError[] };

/**
 * Moment 1: import a CSV for a batch. All-or-nothing.
 * Step 1 (no DB): parse + validate every row, collect every error.
 * Step 2 (one transaction): lock the batch, check ownership and status, check phones already
 * used for the same course, and only then insert all candidates plus an audit row.
 */
export async function importCandidates(user: SessionUser, batchId: string, csvText: string): Promise<ImportResult> {
  // ---- Step 1: parse and validate without touching the database ----
  let rows: Record<string, string>[];
  try {
    rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    return { ok: false, errors: [{ row: 1, column: "file", message: "Could not read the file as CSV" }] };
  }

  const validation = validateRows(rows);
  if (validation.errors.length > 0) return { ok: false, errors: validation.errors };

  // ---- Step 2: one transaction ----
  return prisma.$transaction(async (tx): Promise<ImportResult> => {
    const batch = await lockBatch(tx, batchId);
    assertCentreOwner(user, batch); // identity comes from the session, never the request body
    if (batch.status !== "DRAFT" && batch.status !== "CHANGES_REQUESTED") {
      throw conflict(`Candidates cannot be imported while the batch is ${batch.status}`);
    }

    // A person gets one certificate per course: reject phones already used for this course.
    const phones = validation.candidates.map((c) => c.phone);
    const existing = await tx.candidate.findMany({
      where: { phone: { in: phones }, batch: { course: batch.course } },
      select: { phone: true },
    });
    if (existing.length > 0) {
      const taken = new Set(existing.map((c) => c.phone));
      const errors: ImportError[] = [];
      // Every row is valid at this point, so candidate i came from spreadsheet row i + 2.
      validation.candidates.forEach((c, i) => {
        if (taken.has(c.phone)) {
          errors.push({ row: i + 2, column: "phone", message: `Already registered for ${batch.course}` });
        }
      });
      return { ok: false, errors }; // nothing was written, so nothing to roll back
    }

    await tx.candidate.createMany({
      data: validation.candidates.map((c) => ({ batchId, name: c.name, phone: c.phone })),
    });
    await writeAudit(tx, {
      batchId,
      actorId: user.id,
      action: "CANDIDATES_IMPORTED",
      version: batch.version,
      details: { count: validation.candidates.length },
    });
    return { ok: true, added: validation.candidates.length };
  });
}