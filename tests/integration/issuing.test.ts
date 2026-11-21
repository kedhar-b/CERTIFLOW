import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import { redis } from "../../src/lib/redis";
import { verifyCertificateSignature } from "../../src/lib/signing";
import { publishPendingOutboxEvents } from "../../src/queue/outboxPublisher";
import { closeQueues, issuanceQueue } from "../../src/queue/queues";
import { issueBatch } from "../../src/services/issuingService";
import { verifyCacheKey } from "../../src/services/verifyService";
import {
  app,
  approveCompletely,
  closeConnections,
  loginEveryone,
  resetDatabase,
  seedBase,
  submittedBatch,
  type Agents,
} from "./helpers";
import request from "supertest";

const runIntegration = Boolean(process.env.INTEGRATION);

describe.skipIf(!runIntegration)("issuing and verification (needs Postgres + Redis)", () => {
  let agents: Agents;

  beforeAll(async () => {
    await resetDatabase();
    await seedBase();
    agents = await loginEveryone();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      "TRUNCATE TABLE approvals, certificates, candidates, audit_log, outbox_events, batches RESTART IDENTITY CASCADE",
    );
    const keys = await redis.keys("verify:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await issuanceQueue.obliterate({ force: true });
    await closeQueues();
    await closeConnections();
  });

  async function issuedBatch(candidateCount = 3) {
    const id = await submittedBatch(agents, candidateCount);
    await approveCompletely(agents, id);
    await issueBatch(id);
    const certificate = await prisma.certificate.findFirstOrThrow({
      where: { batchId: id },
      include: { candidate: true },
      orderBy: { createdAt: "asc" },
    });
    return { id, certificate };
  }

  describe("issuing", () => {
    it("M13 creates one signed certificate per candidate and ends in ISSUED", async () => {
      const { id } = await issuedBatch(3);

      const batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
      expect(batch.status).toBe("ISSUED");

      const certificates = await prisma.certificate.findMany({ where: { batchId: id } });
      expect(certificates).toHaveLength(3);
      for (const certificate of certificates) {
        const payload = {
          id: certificate.id,
          number: certificate.number,
          course: certificate.course,
          issueDate: certificate.issueDate.toISOString().slice(0, 10),
        };
        expect(verifyCertificateSignature(payload, certificate.signature)).toBe(true);
      }
    });

    it("M13 running issuing twice, even at the same time, creates no duplicates", async () => {
      const id = await submittedBatch(agents, 3);
      await approveCompletely(agents, id);

      await Promise.all([issueBatch(id), issueBatch(id)]);
      await issueBatch(id);

      expect(await prisma.certificate.count({ where: { batchId: id } })).toBe(3);
      expect(await prisma.auditLog.count({ where: { batchId: id, action: "ISSUING_COMPLETED" } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { type: "WHATSAPP_CERTIFICATE_ISSUED" } })).toBe(3);
    });

    it("M13 does not issue a batch that is not approved", async () => {
      const id = await submittedBatch(agents, 2);
      expect(await issueBatch(id)).toEqual({ created: 0 });
      expect(await prisma.certificate.count()).toBe(0);
    });

    it("M18 publishing the outbox twice enqueues each event once", async () => {
      const id = await submittedBatch(agents, 2);
      await approveCompletely(agents, id);

      expect(await publishPendingOutboxEvents()).toBe(1);
      expect(await publishPendingOutboxEvents()).toBe(0);
      const event = await prisma.outboxEvent.findFirstOrThrow({ where: { type: "BATCH_APPROVED" } });
      expect(event.status).toBe("PUBLISHED");
      expect(await issuanceQueue.getJob(event.id)).toBeTruthy();
    });
  });

  describe("public verification", () => {
    it("M14 returns VALID with a masked name and no phone or email", async () => {
      const { certificate } = await issuedBatch(2);

      const res = await request(app).get(`/verify/${certificate.number}`).expect(200);
      expect(res.body).toEqual({
        status: "VALID",
        maskedName: "C*** N***",
        course: "Welding Level 2",
        issueDate: certificate.issueDate.toISOString().slice(0, 10),
      });

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(certificate.candidate.phone);
      expect(raw).not.toContain("@");
      expect(raw).not.toContain("Candidate");
    });

    it("M14 works without a login", async () => {
      const { certificate } = await issuedBatch(1);
      await request(app).get(`/verify/${certificate.number}`).expect(200);
    });

    it("M16 returns NOT_FOUND for unknown and malformed numbers", async () => {
      const unknown = await request(app).get("/verify/CF-0000-0000-0000-0000").expect(200);
      expect(unknown.body).toEqual({ status: "NOT_FOUND" });
      const malformed = await request(app).get("/verify/not-a-number").expect(200);
      expect(malformed.body).toEqual({ status: "NOT_FOUND" });
    });

    it("M15 cancelling is visible straight away because the cache entry is deleted", async () => {
      const { certificate } = await issuedBatch(1);

      const before = await request(app).get(`/verify/${certificate.number}`).expect(200);
      expect((before.body as { status: string }).status).toBe("VALID");
      expect(await redis.get(verifyCacheKey(certificate.number))).not.toBeNull();

      await agents.district1.post(`/certificates/${certificate.number}/cancel`).send({ reason: "Test" }).expect(403);
      await agents.state.post(`/certificates/${certificate.number}/cancel`).send({ reason: "Issued in error" }).expect(200);
      expect(await redis.get(verifyCacheKey(certificate.number))).toBeNull();

      const after = await request(app).get(`/verify/${certificate.number}`).expect(200);
      expect((after.body as { status: string }).status).toBe("CANCELLED");

      await agents.state.post(`/certificates/${certificate.number}/cancel`).send({ reason: "Again" }).expect(409);
      expect(await prisma.auditLog.count({ where: { action: "CERTIFICATE_CANCELLED" } })).toBe(1);
    });
  });
});
