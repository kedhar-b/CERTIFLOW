import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DISTRICT_A = "district-a";
const DISTRICT_B = "district-b";

async function main() {
  const centreA = await prisma.centre.upsert({
    where: { id: "centre-a1" },
    update: {},
    create: { id: "centre-a1", name: "Centre A1", districtId: DISTRICT_A },
  });

  const users = [
    { email: "operator.a1@certiflow.dev", name: "Operator A1", role: "CENTRE_OPERATOR", districtId: DISTRICT_A, centreId: centreA.id },
    { email: "district1.a@certiflow.dev", name: "District Officer A1", role: "DISTRICT_OFFICER", districtId: DISTRICT_A, centreId: null },
    { email: "district2.a@certiflow.dev", name: "District Officer A2", role: "DISTRICT_OFFICER", districtId: DISTRICT_A, centreId: null },
    { email: "district.b@certiflow.dev", name: "District Officer B1", role: "DISTRICT_OFFICER", districtId: DISTRICT_B, centreId: null },
    { email: "quality@certiflow.dev", name: "Quality Officer", role: "QUALITY_OFFICER", districtId: null, centreId: null },
    { email: "state@certiflow.dev", name: "State Officer", role: "STATE_OFFICER", districtId: null, centreId: null },
    { email: "admin@certiflow.dev", name: "Admin", role: "ADMIN", districtId: null, centreId: null },
  ] as const;

  for (const user of users) {
    await prisma.user.upsert({ where: { email: user.email }, update: {}, create: { ...user } });
  }
  console.log(`Seeded centre ${centreA.id} and ${users.length} users`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
