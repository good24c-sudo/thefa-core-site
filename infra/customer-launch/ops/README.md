# P04 credential host for the existing Stage2 Broker

This is a **reviewed implementation, not an installed provider or admission**.
It belongs to the original P04 customer writer/fence 1. It does not dispatch a
Job, claim an action, issue a grant, produce a terminal, deploy an Edge, or alter
the Production alias. Never execute it instead of the existing Broker gates.

The installed trusted provider composes
`create4060CredentialMethods({readLiveClaim, assertPreservation})` with the P02
`provisionRuntimeCredentialOnce` consumer. `readLiveClaim` is supplied by P02's
`createStage2ClaimReadback`, backed by authenticated `WORKER_VALIDATE` at the
existing worker endpoint. Neither callback may come from caller JSON or be a
constant test success. P02's source owns `reserveOnce` and terminal verification.

`assertPreservation({reserved,claim})` must throw unless the actual current
writer/lease/fence/owned paths, exact published source artifacts, exclusive
release, no-reset backup and restore proof, rollback release, and live customer
data/allowance/RLS/ACL invariants are verified. Its role-password invariant must
allow only this claim's password installation, not changes to other privileges.
This validator and compatible installed Broker are still required integrations;
this package does not pretend that it supplies either of them.

`preservation-readback.mjs` implements the data/ACL portion using one real
read-only PostgreSQL snapshot of all eight customer tables. It compares complete
rowset digests (including usage), RLS/policies, role attributes except its password,
memberships, schema/table/column ACLs, functions, constraints and triggers.
Its expected baseline must be in the exact artifact bytes bound by the live
claim. Matching counts alone, caller booleans and unsigned file paths cannot pass.
This comparison is not a backup restore proof or permission to cut over: those
checks remain required in the trusted provider's complete `assertPreservation`.

`preservation-backup.mjs` supplies an actual same-host data-backup check. It reads
all eight Production tables in one snapshot using the existing 4060 CLI, writes
only DPAPI-protected plaintext-equivalent data to the restricted vault, verifies
the encrypted roundtrip, and restores typed rows into a new network-none
PostgreSQL 17 tmpfs container with no host ports. All restored rowset hashes must
match, a repeated restore must fail, and the live source must still match before
and after. Large integers remain server-produced JSON text throughout. No remote
restore interface exists. This validates customer data recovery, not an ACL or
deployment rollback; the latter still needs the existing release gate.
The real 4060 execution receipt is
`D:/THE_FA_DEV/qa/P04_PRODUCTION_PRESERVATION_BACKUP_20261107/ACTUAL_PRODUCTION_BACKUP_RESTORE.json`.
Backups stay on 4060. Only the nonsecret verification receipt may be relayed.

The five credential methods require exact claim IDs/hashes/expiry on every step.
They use only 4060's existing CLI logins and same-user Windows DPAPI. Password SQL
travels through a temporary named pipe; Vercel bodies use stdin. CLI stdout is
private memory, never a transcript. DPAPI files have only current-user and SYSTEM
access and reject reparse points. Subprocesses do not inherit a process-level
PowerShell execution-policy override. No execution policy or credentials are
copied from 4070. A machine that forbids the helper must use the existing normal
signed installation route; never add ExecutionPolicy Bypass.

Before even staging a credential, the host verifies the exact Vercel project and
team, the existing least-privileged passwordless DB role, and coherent Production
environment settings. Staging settings, fresh-launch, unreadable secrets,
shared DB env targets or duplicate keys stop before DB mutation. This deliberately
**does not solve an atomic cutover by editing only a DB URL**: a verified coherent
release plan is still needed for the current R62/Staging deployment.

The live project currently uses `sensitive` variables, which Vercel does not
allow reading back after creation. The existing encrypted-value method cannot
validate them. An explicit preflight now rejects this case before DPAPI intent
creation or DB password changes. Never convert them to `encrypted`, infer their
values from metadata, or replace this guard with a constant success. A supported
actual deployment-runtime proof and coherent release/rollback integration are
still required before this host can run against the current project.

Exclusive intent, original env snapshot and generated credential are separately
DPAPI protected. A restart cannot overwrite the intent or replay an uncertain
write. The role change touches only its password and must read back SCRAM;
runtime login must negotiate SCRAM over verified TLS, match the exact role, and
reject a wrong password. Vercel success requires a separate decrypted server
readback with the encrypted type and production-only target. It is not inferred
from a POST response or environment metadata.

No automatic rollback/retry is implemented. A partial/unknown result belongs to
the existing Broker reconciliation path; the stored rollback snapshot is input
to that authorized path, not permission to reset the role or customer data.

Sensitive proof implementation (not installed or dispatched):

- `sensitive-build-probe.mjs` runs only in an exact Vercel Production build.
  It uses a read-only SCRAM/TLS connection and emits a single challenge response
  in authenticated build logs. Its only public output is a static verification
  page. It creates no HTTP API, grants, migrations, credential files or aliases.
- `sensitive-proof-contract.mjs` defines exact challenge/proof keys and the
  seven allowed source paths. The challenge binds action/claim/WorkUnit/Native
  receipt, source HEAD, artifact/environment metadata, nonce and expiry.
  `verifyValueProof` compares a keyed response using only the newly generated
  high-entropy DB URL held in the host. No plaintext secret or public secret hash
  is returned. This is value verification, not a new approval/signing service.
- `readVerifiedBuildProof` independently reads provider deployment, project,
  exact uploaded source bytes, environment metadata and build logs. It rejects
  extra source files/functions, aliases, changed SSO protection, wrong hashes,
  stale/duplicate/other-claim proofs and environment changes. It does not accept
  a caller's standalone success object. Only this fixed probe plan may run.
- `vercel-proof-reader.mjs` supplies the real 4060 existing-CLI GET transport.
  Read-only live QA verified the project/team, current R62 deployment, 18 env
  metadata entries (10 sensitive), 25 build events, and refusal to download the
  unrelated existing customer source as a probe. This is not a live proof for a
  newly installed credential.

The P02 owner must bind this versioned proof to the existing exact artifact,
Native/claim admission and WORKER_RESULT verifier before installation. Source
HEAD comes from the Native manifest (do not put a self-referential commit SHA
inside its own artifact). The deployment controller is still required to enforce
one attempt, no env/buildEnv overrides, exact files/commands, no automatic alias
or promotion, and durable reconciliation of uncertain effects. In particular,
cloud metadata alone cannot prove that a request omitted environment overrides.
Project protection must remain unchanged. The current encrypted-only credential
methods deliberately continue to reject sensitive variables until this coupled
path and actual environment/role/ACL/deployment rollback are verified. Neither
the independent reader nor a passing fixture substitutes for these gates.

QA: `node --test infra/customer-launch/ops/credential-host.test.mjs` is isolated
with explicit injected fixtures. It is not actual Production credential QA.
Real 4060 canaries separately verified DPAPI roundtrip and duplicate-write
rejection, existing authenticated Supabase SELECT over named pipe, and Vercel
project/team + environment readback. The current environment correctly returns
`ATOMIC_PRODUCTION_ENV_RELEASE_REQUIRED`; no Production write was performed.
