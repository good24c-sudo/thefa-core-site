# Customer provider runtime

This connects the existing NativeHost customer policy, official Work Unit API,
and existing Action Broker ledger. Only the approved INSTALL_AUTH_SCHEMA stage
for customer project cgrppxfdurpzzfvkmfte is implemented. It cannot reset usage,
import customer data, change Google credentials, execute arbitrary SQL, or replay
the original R45 job.

The Edge handler uses separate internal credentials for producer, authority,
provider and receipt verification routes. It obtains Fresh GitHub HEAD itself;
the private DB extension independently binds the consumed NativeHost policy,
current writer/fence, exact manifest and official Work Unit ID. Existing Broker
prepare/claim/pending/reconcile/finalize functions remain the action state machine.

The 4060 provider worker retains the existing Supabase CLI login on that PC.
It claims one existing action, verifies actual input files and the pinned SQL
bundle, executes one transaction and performs a separate catalog readback.
Uncertain outcomes never retry the mutation. SQL result evidence is cross-checked
and hashed in the server and again on the worker; terminal state comes from the
existing Broker, not a local boolean or test result.

Install-BrokerSettings.ps1 creates four new internal credentials on4060, stores
them with that user's DPAPI in a restricted directory, installs the four endpoint
settings and four credentials into the existing Core project, verifies server
digests and removes its protected one-shot plaintext env file. Existing company
credentials are not copied. An existing setup or partial write requires readback,
never automatic replacement of credentials.

The included thefa-action-broker source is the deployed v22 implementation with
only two built-in Supabase environment aliases added. Its auth, action ledger,
production policy and reconciliation checks remain in place. The SQL under
tests/fixtures is an unchanged existing Broker snapshot for isolated tests only.

Local tests use explicit TEST_ONLY NativeHost/HTTP/CLI fixtures. Their success is
not live authentication, an installed Work Unit, or customer Production completion.
Actual installation, admission, effect, catalog readback and terminal receipts
must be recorded separately. Customer E2E remains a separate completion boundary.
