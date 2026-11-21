import type { Request, Response } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import {
  addCandidates,
  approveBatch,
  createBatch,
  getBatchForUser,
  rejectBatch,
  resubmitBatch,
  sendBackBatch,
  submitBatch,
} from "../services/batchService";

const idParams = z.object({ id: z.string().uuid() });

const createBatchBody = z.object({ course: z.string().trim().min(1).max(200) });

const addCandidatesBody = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().regex(/^\+?[0-9]{8,15}$/, "Phone must be 8-15 digits"),
        email: z.string().trim().email().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

const reasonBody = z.object({ reason: z.string().trim().min(1).max(1000) });

function batchSummary(batch: { id: string; status: string; version: number; size: number; course: string }) {
  return { id: batch.id, status: batch.status, version: batch.version, size: batch.size, course: batch.course };
}

export async function createBatchHandler(req: Request, res: Response) {
  const body = createBatchBody.parse(req.body);
  const batch = await createBatch(requireUser(req), body);
  res.status(201).json(batchSummary(batch));
}

export async function addCandidatesHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = addCandidatesBody.parse(req.body);
  res.status(201).json(await addCandidates(requireUser(req), id, body.candidates));
}

export async function submitHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(batchSummary(await submitBatch(requireUser(req), id)));
}

export async function resubmitHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(batchSummary(await resubmitBatch(requireUser(req), id)));
}

export async function approveHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(batchSummary(await approveBatch(requireUser(req), id)));
}

export async function sendBackHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { reason } = reasonBody.parse(req.body);
  res.json(batchSummary(await sendBackBatch(requireUser(req), id, reason)));
}

export async function rejectHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { reason } = reasonBody.parse(req.body);
  res.json(batchSummary(await rejectBatch(requireUser(req), id, reason)));
}

export async function getBatchHandler(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await getBatchForUser(requireUser(req), id));
}

export { reasonBody };
