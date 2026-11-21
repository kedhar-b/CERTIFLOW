import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  app,
  approveCompletely,
  closeConnections,
  fakeCandidates,
  loginEveryone,
  resetDatabase,
  seedBase,
  submittedBatch,
  type Agents,
} from "./helpers";

const runIntegration = Boolean(process.env.INTEGRATION);

describe.skipIf(!runIntegration)("batch workflow (needs Postgres + Redis)", () => {
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
  });

  afterAll(closeConnections);

  describe("M06 identity comes from the session cookie", () => {
    it("M06 returns 401 without a session", async () => {
      await request(app).post("/batches").send({ course: "Welding" }).expect(401);
    });

    it("M06 ignores an unsigned, hand-made cookie", async () => {
      const forged = encodeURIComponent(JSON.stringify({ id: "x", role: "STATE_OFFICER", districtId: null, centreId: null }));
      await request(app).post("/batches").set("Cookie", `cf_session=${forged}`).send({ course: "Welding" }).expect(401);
    });

    it("M06 ignores user, role and centre values sent in the body", async () => {
      const res = await agents.operator
        .post("/batches")
        .send({ course: "Welding", centreId: "centre-a2", createdById: "someone-else", role: "STATE_OFFICER" })
        .expect(201);
      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: (res.body as { id: string }).id } });
      expect(batch.centreId).toBe("centre-a1");
      expect(batch.createdById).not.toBe("someone-else");
    });

    it("M06 rejects invalid input with 400", async () => {
      await agents.operator.post("/batches").send({ course: "" }).expect(400);
      const id = (await agents.operator.post("/batches").send({ course: "Welding" })).body.id as string;
      await agents.operator.post(`/batches/${id}/candidates`).send({ candidates: [{ name: "A", phone: "abc" }] }).expect(400);
      await agents.operator.post("/batches/not-a-uuid/submit").expect(400);
    });
  });

  describe("approval quorum", () => {
    it("M07 needs two distinct district officers, then moves on", async () => {
      const id = await submittedBatch(agents, 2);

      const first = await agents.district1.post(`/batches/${id}/approve`).expect(200);
      expect((first.body as { status: string }).status).toBe("DISTRICT_REVIEW");

      const second = await agents.district2.post(`/batches/${id}/approve`).expect(200);
      expect((second.body as { status: string }).status).toBe("STATE_REVIEW");

      const done = await agents.state.post(`/batches/${id}/approve`).expect(200);
      expect((done.body as { status: string }).status).toBe("APPROVED");
    });

    it("M04 a big batch goes through quality review before state review", async () => {
      const id = await submittedBatch(agents, 5); // BIG_BATCH is 5 in the test config
      await agents.district1.post(`/batches/${id}/approve`).expect(200);
      const afterQuorum = await agents.district2.post(`/batches/${id}/approve`).expect(200);
      expect((afterQuorum.body as { status: string }).status).toBe("QUALITY_REVIEW");

      await agents.state.post(`/batches/${id}/approve`).expect(403);
      const afterQuality = await agents.quality.post(`/batches/${id}/approve`).expect(200);
      expect((afterQuality.body as { status: string }).status).toBe("STATE_REVIEW");
    });

    it("M08 the same officer approving twice is rejected and counts once", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.district1.post(`/batches/${id}/approve`).expect(200);
      await agents.district1.post(`/batches/${id}/approve`).expect(409);

      const batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
      expect(batch.status).toBe("DISTRICT_REVIEW");
      expect(await prisma.approval.count({ where: { batchId: id } })).toBe(1);
    });

    it("M12 two simultaneous approvals are both recorded and the batch advances exactly once", async () => {
      const id = await submittedBatch(agents, 2);
      const [a, b] = await Promise.all([
        agents.district1.post(`/batches/${id}/approve`),
        agents.district2.post(`/batches/${id}/approve`),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);

      const batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
      expect(batch.status).toBe("STATE_REVIEW");
      expect(await prisma.approval.count({ where: { batchId: id, step: "DISTRICT" } })).toBe(2);
      expect(await prisma.auditLog.count({ where: { batchId: id, action: "STEP_APPROVED" } })).toBe(1);
    });
  });

  describe("authorisation", () => {
    it("M09 an officer from another district gets 403", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.districtB.post(`/batches/${id}/approve`).expect(403);
      await agents.districtB.post(`/batches/${id}/send-back`).send({ reason: "no" }).expect(403);
    });

    it("M09 the wrong role for the step gets 403", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.quality.post(`/batches/${id}/approve`).expect(403);
      await agents.state.post(`/batches/${id}/approve`).expect(403);
      await agents.operator.post(`/batches/${id}/approve`).expect(403);
    });

    it("M09 reviewing a batch that is not in review is a 409, not an approval", async () => {
      const created = await agents.operator.post("/batches").send({ course: "Welding" });
      const id = (created.body as { id: string }).id;
      await agents.district1.post(`/batches/${id}/approve`).expect(409);
    });

    it("M10 an operator from another centre gets 403", async () => {
      const created = await agents.operator.post("/batches").send({ course: "Welding" });
      const id = (created.body as { id: string }).id;
      await agents.otherOperator.post(`/batches/${id}/candidates`).send({ candidates: fakeCandidates(1) }).expect(403);
      await agents.otherOperator.post(`/batches/${id}/submit`).expect(403);
      await agents.otherOperator.get(`/batches/${id}`).expect(403);
    });

    it("M10 only operators can create batches", async () => {
      await agents.district1.post("/batches").send({ course: "Welding" }).expect(403);
    });
  });

  describe("send-back and resubmit", () => {
    it("M11 send-back keeps approvals and audit rows, resubmit bumps the version, old approvals stop counting", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.district1.post(`/batches/${id}/approve`).expect(200);
      await agents.district2.post(`/batches/${id}/send-back`).send({ reason: "Photo missing" }).expect(200);

      const sentBack = await prisma.batch.findUniqueOrThrow({ where: { id } });
      expect(sentBack.status).toBe("CHANGES_REQUESTED");
      expect(sentBack.version).toBe(1);
      expect(await prisma.approval.count({ where: { batchId: id, version: 1 } })).toBe(1);
      const auditBefore = await prisma.auditLog.count({ where: { batchId: id } });

      await agents.operator.post(`/batches/${id}/resubmit`).expect(200);
      const resubmitted = await prisma.batch.findUniqueOrThrow({ where: { id } });
      expect(resubmitted.status).toBe("DISTRICT_REVIEW");
      expect(resubmitted.version).toBe(2);
      expect(await prisma.auditLog.count({ where: { batchId: id } })).toBeGreaterThan(auditBefore);

      // district1's approval was for version 1, so they can approve again and it does not reach quorum alone.
      const again = await agents.district1.post(`/batches/${id}/approve`).expect(200);
      expect((again.body as { status: string }).status).toBe("DISTRICT_REVIEW");
      expect(await prisma.approval.count({ where: { batchId: id } })).toBe(2);

      const advanced = await agents.district2.post(`/batches/${id}/approve`).expect(200);
      expect((advanced.body as { status: string }).status).toBe("STATE_REVIEW");
    });

    it("M11 resubmit is only possible from CHANGES_REQUESTED", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.operator.post(`/batches/${id}/resubmit`).expect(409);
    });

    it("M11 a rejected batch is final", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.district1.post(`/batches/${id}/reject`).send({ reason: "Fraud suspected" }).expect(200);
      await agents.operator.post(`/batches/${id}/resubmit`).expect(409);
      await agents.district2.post(`/batches/${id}/approve`).expect(409);
    });
  });

  describe("audit trail", () => {
    it("M17 every state change writes an audit row", async () => {
      const id = await submittedBatch(agents, 2);
      await agents.district1.post(`/batches/${id}/approve`).expect(200);
      await agents.district2.post(`/batches/${id}/approve`).expect(200);
      await agents.state.post(`/batches/${id}/approve`).expect(200);

      const actions = (await prisma.auditLog.findMany({ where: { batchId: id }, orderBy: { createdAt: "asc" } })).map(
        (row) => row.action,
      );
      expect(actions).toEqual([
        "BATCH_CREATED",
        "CANDIDATES_ADDED",
        "BATCH_SUBMITTED",
        "APPROVAL_RECORDED",
        "STEP_APPROVED",
        "STEP_APPROVED",
      ]);
    });

    it("M18 reaching APPROVED writes exactly one outbox event", async () => {
      const id = await submittedBatch(agents, 2);
      await approveCompletely(agents, id);
      const events = await prisma.outboxEvent.findMany({ where: { type: "BATCH_APPROVED" } });
      expect(events).toHaveLength(1);
      expect(events[0]?.status).toBe("PENDING");
    });
  });
});
