# CertiFlow moments

> DRAFT. I did not have your original CertiFlow_MOMENTS.md, so these moments are inferred from the
> architecture rules. Replace this file with yours, then rename the matching `describe`/`it` titles in
> `/tests` to your moment ids (each test title below starts with its moment id).

| Id | Moment | Test |
|----|--------|------|
| M01 | Certificate number has the expected shape and comes from random bytes | tests/unit/signing.test.ts |
| M02 | Signed payload is exactly {id, number, course, issueDate}; a tampered payload fails verification | tests/unit/signing.test.ts |
| M03 | Candidate names are masked on the public verify response | tests/unit/signing.test.ts |
| M04 | Small batches skip QUALITY_REVIEW, batches at or over BIG_BATCH go through it | tests/unit/stateMachine.test.ts |
| M05 | Quorum counts distinct officers only | tests/unit/stateMachine.test.ts |
| M06 | Identity comes from the session cookie only; no cookie means 401 | tests/integration/workflow.test.ts |
| M07 | Two distinct district officers approve, then the batch moves on; one approval is not enough | tests/integration/workflow.test.ts |
| M08 | The same officer approving twice is rejected and does not count twice | tests/integration/workflow.test.ts |
| M09 | Officer from another district, or the wrong role for the step, gets 403 | tests/integration/workflow.test.ts |
| M10 | Centre operator from another centre gets 403 | tests/integration/workflow.test.ts |
| M11 | Send-back keeps approvals and audit rows; resubmit bumps version; old approvals no longer count | tests/integration/workflow.test.ts |
| M12 | Two approvals at the same instant are both recorded and the batch advances exactly once | tests/integration/workflow.test.ts |
| M13 | Issuing creates one certificate per candidate and running it twice creates no duplicates | tests/integration/issuing.test.ts |
| M14 | /verify returns VALID with masked name and no phone or email | tests/integration/issuing.test.ts |
| M15 | Cancelling a certificate makes /verify return CANCELLED straight away (cache entry deleted) | tests/integration/issuing.test.ts |
| M16 | Unknown or malformed numbers return NOT_FOUND | tests/integration/issuing.test.ts |
| M17 | Every state change writes an audit_log row | tests/integration/workflow.test.ts |
| M18 | Approval reaching APPROVED writes one outbox event, and publishing twice enqueues it once | tests/integration/issuing.test.ts |
| M19 | WhatsApp stub does not send twice for the same idempotency key | tests/unit/whatsapp.test.ts |
