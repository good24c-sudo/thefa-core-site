# R72 Stage2 compatible release contract

Operation: `CONFIGURE_CUSTOMER_AUTH_ENV`. This is a reviewed candidate until
official installation evidence exists. It does not grant write authority.
The existing `INSTALL_AUTH_SCHEMA` WorkUnit and terminal receipt are read-only
prerequisites and must never be replayed.

## Coupled components

- Existing Broker SQL plus `sql/customer_broker_stage2_v1.sql`.
- `customer-broker-handler.mjs`: obtains Fresh GitHub evidence for Stage2
  WORKER_RESULT using authenticated server context; preserves Stage1 payloads.
- `customer-auth-env-stage2-v2.mjs`: verifies the current source manifest,
  consumed Native receipt, prior Stage1 terminal, unique Broker claim, and
  final Broker receipt bindings. It contains no credential-generation service.
- P04-owned 4060 host: actual DPAPI vault, credential transport, SCRAM/TLS login,
  encrypted Vercel env readback and a coherent deployment/rollback boundary.

SQL alone must not be installed. Stage the exact compatible worker and Edge
artifacts before activating Stage2 admission under the existing release path.
All component hashes, owner admission, fresh writer/fence, Native issuer receipt,
host readiness and rollback reference belong to one release packet. A local QA
result or queue message cannot substitute for any of those records.

`stage2-claim-readback.mjs` supplies P04's `readLiveClaim(reserved)` callback.
Construct `createStage2ClaimReadback({callServer})` using the existing protected
4060 provider transport. It invokes only `WORKER_VALIDATE`, checks the exact
claim/attempt/Native receipt/WorkUnit/hashes/expiry, then normalizes the verified
existing-claim snapshot to P04's `WORKER_CLAIMED` response contract. The server
rechecks consumed Native policy, current writer/fence, Fresh HEAD and the live
uncompleted claim without creating another claim, action or permission.

## Trusted host boundary

All host methods are constructed in trusted host code, never supplied by a
request JSON object. The P04 host owns the five credential operations; P02 owns
Broker/Native policy binding. `reserveOnce` uses the existing WORKER_CLAIM and
does not create a second queue or grant. Every credential operation must recheck
the actual claim, its expiry and the server-authorized target before its effect.

`verifyNativeReceiptFresh` returns `NATIVE_RECEIPT_VERIFIED_FRESH_CONSUMED` only
after checking the real consumed Native policy and exact manifest, source HEAD,
WorkUnit and idempotency. A signed but unconsumed policy is not executable.

`reserveOnce` returns an actual `NEW_EXCLUSIVE_ATTEMPT` with `attempt_id`,
`action_id`, `claim_id`, `work_unit_id`, `receipt_id`, `provider_request_hash`,
`provider_operation_id`, `request_binding_hash`, `admission_receipt_hash`, and
`expires_at`. `attempt_id` is the existing Broker attempt, not a generated local
identifier. Repeated or uncertain reservations only reconcile.

`stageDpapiSecretHandle` returns exactly `{kind:'HOST_DPAPI_SECRET_HANDLE',
handle_id}`. Plaintext credentials never cross this interface or appear in logs.

`recordTerminalReceipt` submits the actual Stage2 WORKER_RESULT, verifies its
receipt, reconciles the same existing Broker action, and reads its terminal.
It returns `SIGNED_COMPLETED_RECEIPT`, `source_authority:THE_FA_ACTION_BROKER`,
`state:COMPLETED`, `provider_terminal_verified:true`, the actual terminal
`receipt_id`, Broker `attempt_id`, `action_id`, `work_unit_id`,
`provider_operation_id`, `request_binding_hash`, `admission_receipt_hash`,
`provider_receipt_hash` and `result_binding_hash`. Never synthesize these values
from requested inputs or fabricate a Native signature/terminal.

Before any Production DB mutation, P04 must prove that the planned encrypted
environment and deployment are coherent and preserve the existing customer
tables/usage. An isolated DB URL edit that mixes old and new auth stores is
blocked. Preserve the prior environment snapshot using host-local DPAPI and
use the existing approved release/rollback route. The orchestrator does not
switch the Production alias.

## Local QA

Node: `node --test ops/core-receipt-binding/tests/*.test.mjs`.

On an already running isolated PostgreSQL container with network disabled and
no published ports, set `THEFA_QA_CONTAINER` and run
`python ops/core-receipt-binding/tests/run-customer-broker-stage2-db-tests.py`.
The script runs the original Stage1 assertions against the Stage2 extension,
then Stage2 enrollment/consume/admit/claim/result/verifier/reconcile/terminal
and rejection paths. Native signatures remain explicit TEST_ONLY fixtures;
the production policy validator itself is not replaced by a stub. Full logs
and exact source hashes are retained; no live service is contacted by this QA.
