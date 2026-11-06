# Customer Production admission

This extends the existing NativeHost and receipt system for the approved customer authentication cutover. Existing STAGING policies and their guard remain unchanged. It installs no provider mutation executor and does not modify CURRENT, leases, the original R45 session, customer data or usage epochs.

`customer-production.mjs` verifies an exact typed manifest and actual local artifact bytes, prepares a policy from the real NativeHost verifier and server context, and exposes fixed issuer/consumer transports. NativeHost's existing NORMAL_WRITE operation authenticates the exact payload; the separate CUSTOMER_PRODUCTION_AUTH policy restricts Production admission to the customer targets and approved operations. Never interpret the NativeHost signature alone as Production authority.

`sql/customer_production_receipt_v1.sql` installs a new private schema in the existing Core control-plane database. Installation is NativeAdmin-only. Admin policy enrollment requires independently verified NativeHost evidence; SQL preserves and matches it against the trusted native context and existing Current/lease/fence checker. SQL does not implement Ed25519 verification or authenticate a human by accepting a boolean.

An exact policy transitions APPROVED → ISSUED → CONSUMED under row locks. Nonce and idempotency keys are unique. Consumers cannot enroll policies or alter their scope. Public, anon, authenticated and service-role callers receive no schema/table/function privileges. Ambiguous outcomes require readback of the original receipt, never a repeated mutation.

Every manifest operation must reference existing, hash-pinned artifacts. Future migration outputs require a new manifest and receipt after their bytes exist. Paths cannot escape the artifact root. Data preservation is required; usage reset and original-job replay are prohibited.

Consumed receipts retain `write_allowed:false`: they are admission evidence to bind into the existing official Work Unit, not proof of dispatch, execution, publication or terminal completion. The executor must separately recheck Fresh GitHub HEAD, artifact bytes, current writer/fence, approved target and protected-job state at the side-effect boundary.

`customer-workunit.mjs` is a read-only integration candidate. Its `prepareBinding` method obtains dedicated-role database evidence, checks current authority and artifact bytes twice, and commits the exact manifest, target, receipt and writer identity into a request hash. Its `inspect` method can compare an existing Broker action with terminal provider evidence. It has no `run`, Broker `prepare` or `execute` method. It cannot accept a Work Unit, grant write rights or perform a provider mutation. Supplying a caller's `verified:true` flag is not evidence.

Construct the candidate only in trusted host code with authenticated database/Core/Broker read adapters. A fixture adapter is not live authentication. The installed Work Unit producer, conditional production fields in its existing request hashes, fixed-target provider executor and Broker authority/verifier services remain separate integration work. Missing adapters fail closed. Do not execute the returned request directly to bypass the official Work Unit gate.

Validation:

```
node --test ops/core-receipt-binding/tests/*.test.mjs
python ops/core-receipt-binding/tests/run-production-db-tests.py
```

The PostgreSQL runner requires an already-running isolated PostgreSQL container. Its fixtures are TEST_ONLY, not live authentication evidence. It tests rejection paths, row locking, rollback and concurrent one-use consumption.
