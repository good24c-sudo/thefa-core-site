// THE FA Guarded Action Broker v1
// Central durable mutation plane. AI adapters request intent; only server authority may authorize execution.

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Json = Record<string, unknown>;
type Provider = "GITHUB" | "DRIVE" | "SUPABASE" | "NCP" | "CORE";
type RuntimeIdentity = { adapter_instance_id: string; adapter_epoch: number };
type BrokerRequest = {
  action?: string;
  adapter_provider?: string;
  runtime_identity?: RuntimeIdentity;
  context_lease_id?: string;
  action_type?: string;
  risk_class?: string;
  target_provider?: Provider;
  intent?: Json;
  idempotency_key?: string;
  action_id?: string;
  expected_parent_head?: string | null;
  execution_request_hash?: string;
};

type PreparedAction = {
  action_id: string;
  context_lease_id: string;
  work_identity_binding_hash: string;
  adapter_instance_id: string;
  adapter_epoch: number;
  action_type: string;
  risk_class: "GUARDED" | "RED";
  target_provider: Provider;
  intent: Json;
  intent_hash: string;
  idempotency_key: string;
  owned_paths: string[];
  owned_paths_hash: string;
  expected_parent_head?: string | null;
  prepared_action_hash: string;
  state: string;
  attempt_count: number;
  last_attempt_id?: string | null;
  authority_receipt_hash?: string | null;
  writer_lease_id?: string | null;
  fencing_generation?: number | null;
  fresh_source_binding_hash?: string | null;
  policy_revision?: string | null;
};

type AuthorityReceipt = {
  authority_receipt_id: string;
  action_id: string;
  prepared_action_hash: string;
  work_identity_binding_hash: string;
  adapter_instance_id: string;
  adapter_epoch: number;
  writer_lease_id: string;
  fencing_generation: number;
  fresh_source_binding_hash: string;
  policy_revision: string;
  issued_at: string;
  expires_at: string;
  receipt_hash: string;
  fresh_source_exact: true;
  writer_lease_active: true;
  server_principal_verified: true;
  policy_allowed: true;
  stale_adapter_epoch_rejected: true;
  fresh_head?: string | null;
  owned_paths_hash?: string;
  fast_forward_only?: boolean;
  force_push_allowed?: boolean;
  representative_approval_verified?: boolean;
  representative_approval_scope_hash?: string;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^(sha256:)?[0-9a-f]{64}$/;
const SENSITIVE = new Set([
  "secret", "service_role", "api_key", "apikey", "access_token", "refresh_token", "password",
  "private_key", "client_secret", "authorization", "raw_pii", "cookie", "session_token", "service_account_key",
]);
const PROVIDERS = new Set<Provider>(["GITHUB", "DRIVE", "SUPABASE", "NCP", "CORE"]);
const RED_ACTIONS = new Set([
  "PRODUCTION_DEPLOY", "PRODUCTION_PROMOTION", "MAIN_MERGE", "DNS_CHANGE", "SECRET_CHANGE",
  "LOGIN_PERMISSION_CHANGE", "PAYMENT", "PRIVILEGE_EXPANSION", "RISKY_OPERATIONAL_DATA_CHANGE",
  "SERVICE_INTERRUPTION",
]);

function required(name: string): string {
  const aliases: Record<string,string> = {THE_FA_SUPABASE_URL: "SUPABASE_URL", THE_FA_SUPABASE_SERVICE_ROLE_REF: "SUPABASE_SERVICE_ROLE_KEY"};
  const value = Deno.env.get(name) || (aliases[name] ? Deno.env.get(aliases[name]) : undefined);
  if (!value) throw new Error(`ENV_${name}_REQUIRED`);
  return value;
}

function sensitive(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(sensitive);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Json)) {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    if (SENSITIVE.has(normalized) && child !== null && child !== "" && child !== false) return true;
    if (sensitive(child)) return true;
  }
  return false;
}

function assertSafe(value: unknown): void {
  if (sensitive(value)) throw new Error("SECRET_LIKE_MATERIAL_REJECTED");
}

function validRuntimeIdentity(value: unknown): value is RuntimeIdentity {
  if (!value || typeof value !== "object") return false;
  const x = value as Json;
  return typeof x.adapter_instance_id === "string" && x.adapter_instance_id.length >= 8
    && Number.isInteger(x.adapter_epoch) && Number(x.adapter_epoch) >= 1;
}

async function rpc(name: string, args: Json): Promise<any> {
  const base = required("THE_FA_SUPABASE_URL");
  const key = required("THE_FA_SUPABASE_SERVICE_ROLE_REF");
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CORE_RPC_${res.status}:${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function internalPost(endpoint: string, bearer: string, body: Json): Promise<any> {
  assertSafe(body);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`INTERNAL_${res.status}:${text.slice(0, 300)}`);
  const parsed = text ? JSON.parse(text) : {};
  assertSafe(parsed);
  return parsed;
}

function providerEndpoint(provider: Provider): string {
  return required(`THE_FA_${provider}_ACTION_PROVIDER_ENDPOINT`);
}

function providerReadbackEndpoint(provider: Provider): string {
  return required(`THE_FA_${provider}_ACTION_READBACK_ENDPOINT`);
}

function validateAuthority(action: PreparedAction, receipt: AuthorityReceipt): string[] {
  const errors: string[] = [];
  const now = Date.now();
  const issued = Date.parse(receipt.issued_at);
  const expires = Date.parse(receipt.expires_at);
  if (receipt.action_id !== action.action_id) errors.push("action_id_mismatch");
  if (receipt.prepared_action_hash !== action.prepared_action_hash) errors.push("prepared_action_hash_mismatch");
  if (receipt.work_identity_binding_hash !== action.work_identity_binding_hash) errors.push("work_binding_mismatch");
  if (receipt.adapter_instance_id !== action.adapter_instance_id) errors.push("adapter_instance_mismatch");
  if (receipt.adapter_epoch !== action.adapter_epoch) errors.push("adapter_epoch_mismatch");
  if (!SHA256.test(receipt.fresh_source_binding_hash)) errors.push("fresh_source_binding_hash_invalid");
  if (!SHA256.test(receipt.receipt_hash)) errors.push("authority_receipt_hash_invalid");
  if (!Number.isInteger(receipt.fencing_generation) || receipt.fencing_generation < 1) errors.push("fencing_generation_invalid");
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires <= now || issued > now || expires - issued > 300_000) {
    errors.push("authority_time_invalid_or_expired");
  }
  if (receipt.fresh_source_exact !== true) errors.push("fresh_source_exact_required");
  if (receipt.writer_lease_active !== true) errors.push("writer_lease_active_required");
  if (receipt.server_principal_verified !== true) errors.push("server_principal_required");
  if (receipt.policy_allowed !== true) errors.push("policy_allow_required");
  if (receipt.stale_adapter_epoch_rejected !== true) errors.push("stale_adapter_epoch_guard_required");
  if (action.target_provider === "GITHUB") {
    if (receipt.fresh_head !== action.expected_parent_head) errors.push("expected_parent_not_equal_fresh_head");
    if (receipt.owned_paths_hash !== action.owned_paths_hash) errors.push("owned_paths_authority_mismatch");
    if (receipt.fast_forward_only !== true) errors.push("fast_forward_only_required");
    if (receipt.force_push_allowed !== false) errors.push("force_push_must_be_false");
  }
  if (action.risk_class === "RED") {
    if (receipt.representative_approval_verified !== true) errors.push("representative_approval_required");
    if (!SHA256.test(receipt.representative_approval_scope_hash ?? "")) errors.push("representative_approval_scope_hash_required");
  }
  return [...new Set(errors)].sort();
}

async function resolvePrepareContext(req: BrokerRequest): Promise<any> {
  return internalPost(
    required("THE_FA_ACTION_AUTHORITY_ENDPOINT"),
    required("THE_FA_ACTION_AUTHORITY_BEARER"),
    {
      mode: "PREPARE_CONTEXT_V1",
      adapter_provider: req.adapter_provider,
      runtime_identity: req.runtime_identity,
      context_lease_id: req.context_lease_id,
      action_type: String(req.action_type ?? "").toUpperCase(),
      target_provider: req.target_provider,
      intent: req.intent,
      idempotency_key: req.idempotency_key,
      ai_self_asserted_write_authority: false,
    },
  );
}

async function issueExecuteAuthority(action: PreparedAction, req: BrokerRequest): Promise<AuthorityReceipt> {
  return internalPost(
    required("THE_FA_ACTION_AUTHORITY_ENDPOINT"),
    required("THE_FA_ACTION_AUTHORITY_BEARER"),
    {
      mode: "EXECUTE_AUTHORITY_V1",
      action_id: action.action_id,
      prepared_action_hash: action.prepared_action_hash,
      work_identity_binding_hash: action.work_identity_binding_hash,
      runtime_identity: req.runtime_identity,
      expected_parent_head: req.expected_parent_head ?? null,
      required_checks: [
        "SERVER_PRINCIPAL", "WORK_IDENTITY_BINDING", "FRESH_SOURCE", "POLICY", "LEASE_FENCE",
        "OWNED_PATHS", "REPRESENTATIVE_APPROVAL_IF_RED", "IDEMPOTENCY", "ADAPTER_EPOCH",
      ],
    },
  ) as Promise<AuthorityReceipt>;
}

async function verifyProviderReceipt(action: PreparedAction, authorityReference: Json, providerResult: Json): Promise<any> {
  return internalPost(
    required("THE_FA_PROVIDER_RECEIPT_VERIFIER_ENDPOINT"),
    required("THE_FA_PROVIDER_RECEIPT_VERIFIER_BEARER"),
    { mode: "VERIFY_PROVIDER_RECEIPT_V1", action, authority_reference: authorityReference, provider_result: providerResult },
  );
}

async function prepare(req: BrokerRequest): Promise<any> {
  if (!validRuntimeIdentity(req.runtime_identity)) throw new Error("RUNTIME_IDENTITY_REQUIRED");
  if (!req.context_lease_id || !req.action_type || !req.target_provider || !PROVIDERS.has(req.target_provider) || !req.intent || !req.idempotency_key) {
    throw new Error("PREPARE_INPUT_INVALID");
  }
  assertSafe(req.intent);
  const context = await resolvePrepareContext(req);
  if (context?.decision !== "PREPARE_CONTEXT_VERIFIED") throw new Error(`PREPARE_CONTEXT_BLOCKED:${context?.decision ?? "UNKNOWN"}`);
  const risk = String(context.risk_class ?? "").toUpperCase();
  const actionType = String(req.action_type).toUpperCase();
  const expectedRisk = RED_ACTIONS.has(actionType) ? "RED" : "GUARDED";
  if (risk !== expectedRisk) throw new Error("RISK_CLASS_AUTHORITY_MISMATCH");
  if (context.adapter_instance_id !== req.runtime_identity.adapter_instance_id || Number(context.adapter_epoch) !== req.runtime_identity.adapter_epoch) {
    throw new Error("STALE_OR_MISMATCHED_ADAPTER_RUNTIME");
  }
  const result = await rpc("ceo_core_prepare_guarded_action_v1", {
    p_context_lease_id: req.context_lease_id,
    p_work_identity_binding_hash: context.work_identity_binding_hash,
    p_adapter_instance_id: context.adapter_instance_id,
    p_adapter_epoch: context.adapter_epoch,
    p_action_type: actionType,
    p_risk_class: risk,
    p_target_provider: req.target_provider,
    p_intent: req.intent,
    p_idempotency_key: req.idempotency_key,
    p_owned_paths: context.owned_paths ?? [],
    p_expected_parent_head: context.expected_parent_head ?? null,
  });
  return result;
}

async function getDispatch(actionId: string): Promise<PreparedAction> {
  const action = await rpc("ceo_core_get_guarded_action_dispatch_v1", { p_action_id: actionId });
  if (!action?.action_id) throw new Error("ACTION_NOT_FOUND");
  assertSafe(action.intent);
  return action as PreparedAction;
}

async function recordProviderResult(actionId: string, attemptId: string, result: Json): Promise<any> {
  return rpc("ceo_core_record_guarded_action_provider_result_v1", {
    p_action_id: actionId,
    p_attempt_id: attemptId,
    p_result_kind: result.kind,
    p_provider_operation_id: result.provider_operation_id ?? null,
    p_provider_request_hash: result.provider_request_hash ?? null,
    p_failure_code: result.failure_code ?? null,
  });
}

async function execute(req: BrokerRequest): Promise<any> {
  if (!validRuntimeIdentity(req.runtime_identity)) throw new Error("RUNTIME_IDENTITY_REQUIRED");
  if (!req.action_id || !req.execution_request_hash || !SHA256.test(req.execution_request_hash)) throw new Error("EXECUTE_INPUT_INVALID");
  if (req.expected_parent_head && !SHA40.test(req.expected_parent_head)) throw new Error("EXPECTED_PARENT_HEAD_INVALID");

  const action = await getDispatch(req.action_id);
  if (action.adapter_instance_id !== req.runtime_identity.adapter_instance_id || action.adapter_epoch !== req.runtime_identity.adapter_epoch) {
    throw new Error("ACTION_RUNTIME_IDENTITY_STALE_OR_MISMATCHED");
  }
  const authority = await issueExecuteAuthority(action, req);
  const authorityErrors = validateAuthority(action, authority);
  if (authorityErrors.length) throw new Error(`AUTHORITY_RECEIPT_INVALID:${authorityErrors.join(",")}`);

  const claim = await rpc("ceo_core_claim_guarded_action_execution_v1", {
    p_action_id: action.action_id,
    p_execution_request_hash: req.execution_request_hash,
    p_authority_receipt_hash: authority.receipt_hash,
    p_writer_lease_id: authority.writer_lease_id,
    p_fencing_generation: authority.fencing_generation,
    p_fresh_source_binding_hash: authority.fresh_source_binding_hash,
    p_policy_revision: authority.policy_revision,
  });
  if (claim?.decision !== "EXECUTION_CLAIMED") return claim;

  const attemptId = String(claim.attempt_id);
  const providerPayload: Json = {
    action_id: action.action_id,
    action_type: action.action_type,
    target_provider: action.target_provider,
    intent: action.intent,
    intent_hash: action.intent_hash,
    owned_paths: action.owned_paths,
    owned_paths_hash: action.owned_paths_hash,
    expected_parent_head: action.expected_parent_head ?? null,
    work_identity_binding_hash: action.work_identity_binding_hash,
    provider_idempotency_key: `thefa:${action.action_id}:${action.idempotency_key}`,
    authority_receipt_hash: authority.receipt_hash,
    fencing_generation: authority.fencing_generation,
  };
  assertSafe(providerPayload);

  let providerResult: any;
  try {
    providerResult = await internalPost(
      providerEndpoint(action.target_provider),
      required("THE_FA_PROVIDER_INTERNAL_BEARER"),
      providerPayload,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "PROVIDER_TRANSPORT_UNKNOWN";
    // Transport errors are ambiguous: request may have reached provider. Never blind retry.
    return recordProviderResult(action.action_id, attemptId, {
      kind: "AMBIGUOUS",
      failure_code: `PROVIDER_TRANSPORT_AMBIGUOUS:${message.slice(0, 100)}`,
    });
  }

  const kind = String(providerResult?.kind ?? "").toUpperCase();
  if (kind === "VERIFIED_RECEIPT") {
    const verified = await verifyProviderReceipt(action, authority as unknown as Json, providerResult);
    if (verified?.verified !== true) {
      return recordProviderResult(action.action_id, attemptId, {
        kind: "AMBIGUOUS",
        provider_operation_id: providerResult.provider_operation_id ?? null,
        provider_request_hash: providerResult.provider_request_hash ?? null,
        failure_code: "PROVIDER_RECEIPT_NOT_VERIFIED",
      });
    }
    if (!SHA256.test(String(verified.provider_request_hash ?? ""))
      || !SHA256.test(String(verified.provider_receipt_hash ?? ""))
      || !SHA256.test(String(verified.result_binding_hash ?? ""))) {
      throw new Error("VERIFIED_RECEIPT_HASH_INVALID");
    }
    if (verified.authority_receipt_hash !== authority.receipt_hash || Number(verified.fencing_generation) !== authority.fencing_generation) {
      throw new Error("VERIFIED_RECEIPT_AUTHORITY_OR_FENCE_MISMATCH");
    }
    return rpc("ceo_core_finalize_guarded_action_v1", {
      p_action_id: action.action_id,
      p_attempt_id: attemptId,
      p_provider: action.target_provider,
      p_provider_operation_id: verified.provider_operation_id,
      p_provider_request_hash: verified.provider_request_hash,
      p_provider_receipt_hash: verified.provider_receipt_hash,
      p_result_binding_hash: verified.result_binding_hash,
      p_authority_receipt_hash: authority.receipt_hash,
      p_fencing_generation: authority.fencing_generation,
      p_receipt_metadata: verified.receipt_metadata ?? {},
    });
  }

  if (["ACCEPTED_RECEIPT_PENDING", "AMBIGUOUS", "DEFINITIVE_RETRYABLE_FAILURE", "DEFINITIVE_FINAL_FAILURE"].includes(kind)) {
    return recordProviderResult(action.action_id, attemptId, { ...providerResult, kind });
  }
  return recordProviderResult(action.action_id, attemptId, {
    kind: "AMBIGUOUS",
    failure_code: "PROVIDER_RESULT_CLASSIFICATION_UNKNOWN",
  });
}

async function reconcile(req: BrokerRequest): Promise<any> {
  if (!req.action_id) throw new Error("ACTION_ID_REQUIRED");
  const claim = await rpc("ceo_core_begin_guarded_action_reconciliation_v1", { p_action_id: req.action_id });
  if (claim?.decision !== "RECONCILIATION_CLAIMED") return claim;
  const action = await getDispatch(req.action_id);
  if (!action.last_attempt_id) throw new Error("RECONCILIATION_ATTEMPT_REQUIRED");

  let readback: any;
  try {
    readback = await internalPost(
      providerReadbackEndpoint(action.target_provider),
      required("THE_FA_PROVIDER_INTERNAL_BEARER"),
      {
        mode: "READBACK_ACTION_V1",
        action_id: action.action_id,
        target_provider: action.target_provider,
        provider_idempotency_key: `thefa:${action.action_id}:${action.idempotency_key}`,
        expected_parent_head: action.expected_parent_head ?? null,
        intent_hash: action.intent_hash,
        authority_receipt_hash: action.authority_receipt_hash,
        fencing_generation: action.fencing_generation,
      },
    );
  } catch {
    return rpc("ceo_core_mark_guarded_action_reconciliation_v1", {
      p_action_id: action.action_id, p_status: "STILL_UNKNOWN", p_result_binding_hash: null,
    });
  }

  const readbackStatus = String(readback?.status ?? "UNKNOWN").toUpperCase();
  if (readbackStatus === "NOT_APPLIED_VERIFIED") {
    return rpc("ceo_core_mark_guarded_action_reconciliation_v1", {
      p_action_id: action.action_id, p_status: "NOT_APPLIED_VERIFIED", p_result_binding_hash: null,
    });
  }
  if (readbackStatus !== "APPLIED_VERIFIED" || !readback.provider_result) {
    return rpc("ceo_core_mark_guarded_action_reconciliation_v1", {
      p_action_id: action.action_id, p_status: "STILL_UNKNOWN", p_result_binding_hash: null,
    });
  }

  const authorityReference: Json = {
    receipt_hash: action.authority_receipt_hash,
    fencing_generation: action.fencing_generation,
    reconciliation: true,
  };
  const verified = await verifyProviderReceipt(action, authorityReference, readback.provider_result as Json);
  if (verified?.verified !== true || !SHA256.test(String(verified.result_binding_hash ?? ""))) {
    return rpc("ceo_core_mark_guarded_action_reconciliation_v1", {
      p_action_id: action.action_id, p_status: "STILL_UNKNOWN", p_result_binding_hash: null,
    });
  }
  return rpc("ceo_core_finalize_guarded_action_v1", {
    p_action_id: action.action_id, p_attempt_id: action.last_attempt_id, p_provider: action.target_provider,
    p_provider_operation_id: verified.provider_operation_id, p_provider_request_hash: verified.provider_request_hash,
    p_provider_receipt_hash: verified.provider_receipt_hash, p_result_binding_hash: verified.result_binding_hash,
    p_authority_receipt_hash: action.authority_receipt_hash, p_fencing_generation: action.fencing_generation,
    p_receipt_metadata: verified.receipt_metadata ?? {},
  });
}

async function actionStatus(req: BrokerRequest): Promise<any> {
  if (!req.action_id) throw new Error("ACTION_ID_REQUIRED");
  return rpc("ceo_core_get_guarded_action_status_v1", { p_action_id: req.action_id });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${required("THE_FA_ACTION_BROKER_BEARER")}`) return new Response("forbidden", { status: 403 });
  let req: BrokerRequest;
  try { req = await request.json(); } catch { return Response.json({ ok: false, error: "JSON_REQUIRED" }, { status: 400 }); }
  try {
    assertSafe(req);
    let result: unknown;
    if (req.action === "prepare_guarded_action") result = await prepare(req);
    else if (req.action === "execute_guarded_action") result = await execute(req);
    else if (req.action === "get_action_status") result = await actionStatus(req);
    else if (req.action === "reconcile_guarded_action") result = await reconcile(req);
    else throw new Error("UNKNOWN_BROKER_ACTION");
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "BROKER_ERROR";
    return Response.json({ ok: false, error: message.slice(0, 500) }, { status: 400 });
  }
});
