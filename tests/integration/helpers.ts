import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/db";
import { redis } from "../../src/lib/redis";

export const app = createApp();
export type Agent = ReturnType<typeof request.agent>;

export const EMAILS = {
  operator: "operator.a1@test.dev",
  otherOperator: "operator.other@test.dev",
  district1: "district1.a@test.dev",
  district2: "district2.a@test.dev",
  districtB: "district.b@test.dev",
  quality: "quality@test.dev",
  state: "state@test.dev",
} as const;

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE approvals, certificates, candidates, audit_log, outbox_events, batches, centres, users RESTART IDENTITY CASCADE",
  );
  const keys = await redis.keys("verify:*");
  if (keys.length > 0) await redis.del(...keys);
}

export async function seedBase(): Promise<void> {
  await prisma.centre.createMany({
    data: [
      { id: "centre-a1", name: "Centre A1", districtId: "district-a" },
      { id: "centre-a2", name: "Centre A2", districtId: "district-a" },
    ],
  });
  await prisma.user.createMany({
    data: [
      { email: EMAILS.operator, name: "Operator", role: "CENTRE_OPERATOR", districtId: "district-a", centreId: "centre-a1" },
      { email: EMAILS.otherOperator, name: "Other Operator", role: "CENTRE_OPERATOR", districtId: "district-a", centreId: "centre-a2" },
      { email: EMAILS.district1, name: "District 1", role: "DISTRICT_OFFICER", districtId: "district-a" },
      { email: EMAILS.district2, name: "District 2", role: "DISTRICT_OFFICER", districtId: "district-a" },
      { email: EMAILS.districtB, name: "District B", role: "DISTRICT_OFFICER", districtId: "district-b" },
      { email: EMAILS.quality, name: "Quality", role: "QUALITY_OFFICER" },
      { email: EMAILS.state, name: "State", role: "STATE_OFFICER" },
    ],
  });
}

export async function loginAs(email: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post("/auth/dev-login").send({ email });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

export interface Agents {
  operator: Agent;
  otherOperator: Agent;
  district1: Agent;
  district2: Agent;
  districtB: Agent;
  quality: Agent;
  state: Agent;
}

export async function loginEveryone(): Promise<Agents> {
  return {
    operator: await loginAs(EMAILS.operator),
    otherOperator: await loginAs(EMAILS.otherOperator),
    district1: await loginAs(EMAILS.district1),
    district2: await loginAs(EMAILS.district2),
    districtB: await loginAs(EMAILS.districtB),
    quality: await loginAs(EMAILS.quality),
    state: await loginAs(EMAILS.state),
  };
}

export function fakeCandidates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Candidate Number${index}`,
    phone: `+9199000000${String(index).padStart(2, "0")}`,
    email: `candidate${index}@example.com`,
  }));
}

/** Operator creates a batch, adds candidates and submits it. Returns the batch id. */
export async function submittedBatch(agents: Agents, candidateCount = 2): Promise<string> {
  const created = await agents.operator.post("/batches").send({ course: "Welding Level 2" });
  const id = (created.body as { id: string }).id;
  await agents.operator.post(`/batches/${id}/candidates`).send({ candidates: fakeCandidates(candidateCount) }).expect(201);
  await agents.operator.post(`/batches/${id}/submit`).expect(200);
  return id;
}

/** Runs the whole approval chain, including quality review for big batches. */
export async function approveCompletely(agents: Agents, batchId: string, big = false): Promise<void> {
  await agents.district1.post(`/batches/${batchId}/approve`).expect(200);
  await agents.district2.post(`/batches/${batchId}/approve`).expect(200);
  if (big) await agents.quality.post(`/batches/${batchId}/approve`).expect(200);
  await agents.state.post(`/batches/${batchId}/approve`).expect(200);
}

export async function closeConnections(): Promise<void> {
  await prisma.$disconnect();
  redis.disconnect();
}
