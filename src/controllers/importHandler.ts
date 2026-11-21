import type { Request, Response } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { badRequest } from "../lib/errors";
import { importCandidates } from "../services/importService";

const idParams = z.object({ id: z.string().uuid() });

export async function importHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  if (typeof req.body !== "string" || req.body.length === 0) {
    throw badRequest("Send the CSV as the request body with Content-Type: text/csv");
  }
  const result = await importCandidates(requireUser(req), id, req.body);
  if (!result.ok) {
    res.status(422).json({ errors: result.errors }); // exact row/column errors, nothing saved
    return;
  }
  res.status(201).json({ added: result.added });
}
