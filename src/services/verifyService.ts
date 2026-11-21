import { config } from "../config";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { maskName } from "../lib/signing";

export type VerifyResult =
  | { status: "NOT_FOUND" }
  | { status: "VALID" | "CANCELLED"; maskedName: string; course: string; issueDate: string };

export const verifyCacheKey = (number: string) => `verify:${number}`;

export async function verifyCertificate(number: string): Promise<VerifyResult> {
  const key = verifyCacheKey(number);

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as VerifyResult;
  } catch (error) {
    // Redis is only a cache; if it is down we answer from Postgres.
    logger.warn("verify cache read failed", { error: String(error) });
  }

  const certificate = await prisma.certificate.findUnique({
    where: { number },
    select: { status: true, course: true, issueDate: true, candidate: { select: { name: true } } },
  });
  if (!certificate) return { status: "NOT_FOUND" };

  const result: VerifyResult = {
    status: certificate.status,
    maskedName: maskName(certificate.candidate.name),
    course: certificate.course,
    issueDate: certificate.issueDate.toISOString().slice(0, 10),
  };

  try {
    await redis.set(key, JSON.stringify(result), "EX", config.CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn("verify cache write failed", { error: String(error) });
  }
  return result;
}
