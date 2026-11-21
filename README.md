# CertiFlow backend

Express + TypeScript + Prisma 7 + Postgres + Redis + BullMQ. Issues and verifies skilling certificates
with a maker-checker approval flow.

## Run it

```bash
cp .env.example .env            # then edit SESSION_SECRET; run `npm run keygen` and paste the key line
npm install
docker compose up -d postgres redis pgadmin
npx prisma generate
npx prisma migrate dev --name init     # creates prisma/migrations and the tables
npm run seed                    # centre + one user per role
npm run dev                     # API on http://localhost:4000
```

`docker compose up` (all four services, including the API) works once `prisma/migrations` exists,
because the API container runs `prisma migrate deploy` on start.

pgAdmin: http://localhost:5050 (`admin@certiflow.dev` / `admin`), register a server with host `postgres`,
port `5432`, user `certiflow`, password `certiflow_dev`.

## Tests

```bash
npm run test:unit         # no services needed
npm run test:integration  # needs Postgres + Redis from docker compose, and `migrate dev` already run
npm run typecheck
```

Integration tests truncate every table in the database named by `TEST_DATABASE_URL`
(falls back to `DATABASE_URL`). Point it at a throwaway database, not data you care about.

## Demo flow

All calls use a cookie jar (`-c jar -b jar`). `/auth/dev-login` exists only outside production.

```bash
login() { curl -s -c "$1" -H 'content-type: application/json' -d "{\"email\":\"$2\"}" localhost:4000/auth/dev-login; }
login op   operator.a1@certiflow.dev
login d1   district1.a@certiflow.dev
login d2   district2.a@certiflow.dev
login st   state@certiflow.dev

ID=$(curl -s -b op -H 'content-type: application/json' -d '{"course":"Welding Level 2"}' localhost:4000/batches | jq -r .id)
curl -s -b op -H 'content-type: application/json' -d '{"candidates":[{"name":"Ravi Kumar","phone":"+919876543210"}]}' localhost:4000/batches/$ID/candidates
curl -s -b op -X POST localhost:4000/batches/$ID/submit
curl -s -b d1 -X POST localhost:4000/batches/$ID/approve     # 1 of 2
curl -s -b d2 -X POST localhost:4000/batches/$ID/approve     # quorum -> STATE_REVIEW (or QUALITY_REVIEW if size >= BIG_BATCH)
curl -s -b st -X POST localhost:4000/batches/$ID/approve     # APPROVED; workers issue within ~1-2 seconds
```

Then read the certificate number from Postgres (`select number from certificates;`) and open
`GET /verify/<number>`.

## Endpoints

| Method | Path | Who |
|---|---|---|
| POST | /auth/dev-login, /auth/logout | dev only / any |
| GET | /me | logged in |
| POST | /batches | centre operator |
| POST | /batches/:id/candidates, /submit, /resubmit | owning centre operator |
| POST | /batches/:id/approve, /send-back, /reject | officer for the current step (district officers: same district only) |
| GET | /batches/:id | owning centre, same-district officer, quality/state/admin |
| POST | /certificates/:number/cancel | state officer, admin |
| GET | /verify/:number | public, rate limited |
| GET | /public-key | public (Ed25519 public key, PEM) |

## Design notes

- State changes live in `src/services/batchService.ts`. Each is one `prisma.$transaction` that locks the batch row
  (`SELECT ... FOR UPDATE`), writes `audit_log`, and writes `outbox_events` where needed.
- Pure routing rules (which step, which role, quorum) are in `src/domain/stateMachine.ts`.
- Issuing (`src/services/issuingService.ts`) is two transactions, APPROVED to ISSUING and ISSUING to ISSUED, and is safe to retry.
- The outbox publisher moves rows into BullMQ using the row id as the job id; workers retry with exponential backoff
  and park exhausted jobs in the `dead-letter` queue.
- Session is a signed cookie (`cf_session`). Replace `/auth/dev-login` with real login before go-live.
- `CertiFlow_MOMENTS.md` is a draft inferred from the rules; replace it with yours and rename test titles to match.
