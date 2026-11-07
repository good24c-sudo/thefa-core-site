-- Isolated CUSTOMER Production admission extension. Apply only through the
-- approved Core NativeAdmin installation path after exact-head QA/review.
-- Does not alter the STAGING guard, existing roles/ACLs, CURRENT or leases.
-- NativeAdmin must run the real NativeHost verifier before enrolling policy.
-- PostgreSQL compares/preserves that proof; it does not verify Ed25519 itself.
-- A consumed receipt is admission evidence, never a Work Unit/terminal receipt.
BEGIN;
SET LOCAL lock_timeout='5s';

DO $preflight$
BEGIN
  PERFORM thefa_native_host_v1.require_admin_v1();
  IF current_user<>'postgres' OR to_regnamespace('thefa_customer_production_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'NATIVE_ADMIN_FRESH_INSTALL_REQUIRED';
  END IF;
  IF to_regclass('thefa_native_host_v1.trusted_contexts_v1') IS NULL
    OR to_regprocedure('public.ceo_core_receipt_current_matches_v2(jsonb)') IS NULL
    OR to_regprocedure('public.ceo_core_receipt_require_role_v2(text)') IS NULL
    OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'EXISTING_AUTHORITY_PRIMITIVES_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
    ('thefa_core_receipt_issuer_v1','thefa_core_receipt_consumer_v1')
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
    AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)<>2 THEN
    RAISE EXCEPTION 'EXISTING_RESTRICTED_CALLER_ROLES_REQUIRED';
  END IF;
END $preflight$;

CREATE SCHEMA thefa_customer_production_v1 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA thefa_customer_production_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE thefa_customer_production_v1.policies_v1 (
  receipt_id uuid PRIMARY KEY,
  nonce_hash text NOT NULL UNIQUE CHECK(nonce_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 600),
  session_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  context_hash text NOT NULL CHECK(context_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'APPROVED' CHECK(state IN ('APPROVED','ISSUED','CONSUMED','EXPIRED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  registered_at timestamptz,
  consumed_at timestamptz,
  consumer_role text,
  revoked_at timestamptz,
  FOREIGN KEY(session_id,grant_id) REFERENCES thefa_native_host_v1.trusted_contexts_v1(session_id,grant_id),
  CHECK(expires_at>issued_at AND expires_at-issued_at<=interval '2 minutes'),
  CHECK((state='CONSUMED')=(consumed_at IS NOT NULL)),
  CHECK((consumed_at IS NULL)=(consumer_role IS NULL)),
  CHECK((state='REVOKED')=(revoked_at IS NOT NULL))
);
ALTER TABLE thefa_customer_production_v1.policies_v1 ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION thefa_customer_production_v1.exact_keys_v1(o jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $keys$
  SELECT CASE WHEN jsonb_typeof(o) IS DISTINCT FROM 'object' THEN false ELSE
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(o) k)
      IS NOT DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(keys) k) END
$keys$;

CREATE FUNCTION thefa_customer_production_v1.validate_policy_v1(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $validate$
DECLARE b jsonb; m jsonb; f text; v jsonb; proof jsonb; artifact jsonb;
 c thefa_native_host_v1.trusted_contexts_v1%rowtype; t timestamptz;
 keys text[]:=ARRAY['actor_ref','audience','branch','fencing_generation','head_sha','idempotency_key',
 'key_fingerprint','key_id','operation_kind','owned_paths','owning_issue','project_key','repository',
 'room_family','room_instance','session_ref','source_message_hash','target_environment',
 'work_identity_binding_hash','workstream_key','writer_grant_ref','writer_grant_revision','writer_id',
 'writer_lease_idempotency_key','writer_lease_work_key'];
BEGIN
 IF NOT thefa_customer_production_v1.exact_keys_v1(p,ARRAY['receipt_id','nonce_hash','receipt_hash',
  'representative_person_id','scope','payload_hash','source_ref','issued_at','expires_at',
  'session_id','grant_id','context_hash','binding','manifest_canonical','proof','verification']) THEN
   RAISE EXCEPTION 'EXACT_CUSTOMER_PRODUCTION_POLICY_REQUIRED'; END IF;
 FOREACH f IN ARRAY ARRAY['receipt_id','nonce_hash','receipt_hash','representative_person_id','scope',
  'payload_hash','source_ref','issued_at','expires_at','session_id','grant_id','context_hash','manifest_canonical'] LOOP
  IF jsonb_typeof(p->f) IS DISTINCT FROM 'string' OR length(p->>f)=0 OR length(p->>f)>65536 THEN
   RAISE EXCEPTION 'POLICY_STRING_TYPE_REQUIRED'; END IF;
 END LOOP;
 IF p->>'nonce_hash' !~ '^[0-9a-f]{64}$' OR p->>'receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
  OR p->>'payload_hash' !~ '^sha256:[0-9a-f]{64}$' OR p->>'context_hash' !~ '^sha256:[0-9a-f]{64}$'
  OR p->>'scope'<>'P04:00_v25:THE_FA_CORE_CUSTOMER_LAUNCH_V1' THEN
  RAISE EXCEPTION 'EXACT_CUSTOMER_RECEIPT_SCOPE_REQUIRED'; END IF;
 b:=p->'binding'; v:=p->'verification'; proof:=p->'proof';
 IF NOT thefa_customer_production_v1.exact_keys_v1(b,keys) THEN RAISE EXCEPTION 'EXACT_CORE_BINDING_REQUIRED'; END IF;
 FOREACH f IN ARRAY keys LOOP
  IF b->f='null'::jsonb OR length(b->>f)=0 THEN RAISE EXCEPTION 'CORE_BINDING_FIELD_REQUIRED'; END IF;
  IF f NOT IN ('owned_paths','fencing_generation','writer_grant_revision') AND jsonb_typeof(b->f)<>'string'
   THEN RAISE EXCEPTION 'CORE_BINDING_STRING_REQUIRED'; END IF;
 END LOOP;
 IF b->>'project_key'<>'P04' OR b->>'room_family'<>'00' OR b->>'room_instance'<>'00_v25'
  OR b->>'workstream_key'<>'THE_FA_CORE_CUSTOMER_LAUNCH_V1'
  OR b->>'repository'<>'good24c-sudo/thefa-core-site'
  OR b->>'branch'<>'codex/core-customer-launch-v1-20261029'
  OR b->>'target_environment'<>'PRODUCTION' OR b->>'audience'<>'THE_FA_WORK_UNIT_API_V2'
  OR b->>'operation_kind'<>'CUSTOMER_PRODUCTION_AUTH'
  OR b->>'head_sha' !~ '^[0-9a-f]{40}$'
  OR b->>'source_message_hash' !~ '^sha256:[0-9a-f]{64}$'
  OR b->>'key_fingerprint' !~ '^sha256:[0-9a-f]{64}$'
  OR b->>'work_identity_binding_hash' !~ '^sha256:[0-9a-f]{64}$'
  OR jsonb_typeof(b->'owned_paths')<>'array' OR jsonb_array_length(b->'owned_paths')=0
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'owned_paths') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')=0)
  OR jsonb_typeof(b->'fencing_generation')<>'number' OR b->>'fencing_generation' !~ '^[1-9][0-9]*$'
  OR jsonb_typeof(b->'writer_grant_revision')<>'number' OR b->>'writer_grant_revision' !~ '^[1-9][0-9]*$'
  OR b->>'idempotency_key' !~ '^[A-Za-z0-9:_-]{8,160}$' THEN RAISE EXCEPTION 'CUSTOMER_PRODUCTION_CORE_BINDING_INVALID'; END IF;
 m:=(p->>'manifest_canonical')::jsonb;
 IF NOT thefa_customer_production_v1.exact_keys_v1(m,ARRAY['contract','action','environment',
 'supabase_project_ref','vercel_project_id','origin','operations','preserve_data','reset_usage_epoch',
 'replay_original_job','protected_session_id','expected_head','idempotency_key','artifacts']) THEN
  RAISE EXCEPTION 'EXACT_PRODUCTION_MANIFEST_REQUIRED'; END IF;
 IF m->'contract' IS DISTINCT FROM '"THE_FA_CUSTOMER_PRODUCTION_AUTH_V1"'::jsonb
  OR m->'action' IS DISTINCT FROM '"CUSTOMER_AUTH_PRODUCTION_CUTOVER"'::jsonb
  OR m->'environment' IS DISTINCT FROM '"PRODUCTION"'::jsonb
  OR m->'supabase_project_ref' IS DISTINCT FROM '"cgrppxfdurpzzfvkmfte"'::jsonb
  OR m->'vercel_project_id' IS DISTINCT FROM '"prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo"'::jsonb
  OR m->'origin' IS DISTINCT FROM '"https://thefacore.com"'::jsonb
  OR m->'preserve_data' IS DISTINCT FROM 'true'::jsonb
  OR m->'reset_usage_epoch' IS DISTINCT FROM 'false'::jsonb
  OR m->'replay_original_job' IS DISTINCT FROM 'false'::jsonb
  OR m->'protected_session_id' IS DISTINCT FROM '"111c339990e7926f4e8b226e"'::jsonb
  OR m->'expected_head' IS DISTINCT FROM b->'head_sha'
  OR m->'idempotency_key' IS DISTINCT FROM b->'idempotency_key'
  OR p->>'payload_hash' IS DISTINCT FROM 'sha256:'||encode(extensions.digest(convert_to(p->>'manifest_canonical','UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'EXACT_APPROVED_PRODUCTION_TARGET_REQUIRED'; END IF;
 IF jsonb_typeof(m->'operations') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'OPERATIONS_ARRAY_REQUIRED'; END IF;
 IF jsonb_array_length(m->'operations') NOT BETWEEN 1 AND 4
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(m->'operations') x WHERE jsonb_typeof(x)<>'string'
    OR x#>>'{}' NOT IN ('INSTALL_AUTH_SCHEMA','PRESERVE_CUSTOMER_MIGRATION','CONFIGURE_GOOGLE_CALLBACK','CONFIGURE_CUSTOMER_AUTH_ENV'))
  OR (SELECT count(*) FROM jsonb_array_elements(m->'operations'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(m->'operations') x)
  THEN RAISE EXCEPTION 'APPROVED_CUSTOMER_AUTH_OPERATIONS_ONLY'; END IF;
 IF jsonb_typeof(m->'artifacts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'EXACT_ARTIFACTS_REQUIRED'; END IF;
 IF jsonb_array_length(m->'artifacts') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'BOUNDED_EXACT_ARTIFACTS_REQUIRED'; END IF;
 FOR artifact IN SELECT x FROM jsonb_array_elements(m->'artifacts') x LOOP
  IF NOT thefa_customer_production_v1.exact_keys_v1(artifact,ARRAY['operation','path','sha256'])
   OR jsonb_typeof(artifact->'operation') IS DISTINCT FROM 'string'
   OR jsonb_typeof(artifact->'path') IS DISTINCT FROM 'string'
   OR jsonb_typeof(artifact->'sha256') IS DISTINCT FROM 'string'
   OR NOT (m->'operations' @> jsonb_build_array(artifact->'operation'))
   OR coalesce(artifact->>'sha256','') !~ '^[0-9a-f]{64}$'
   OR artifact->>'sha256'=repeat('0',64)
   OR length(artifact->>'path')>500
   OR coalesce(artifact->>'path','') !~ '^[A-Za-z0-9_-][A-Za-z0-9._/-]*$'
   OR artifact->>'path' ~ '(^|/)\.{1,2}(/|$)|//|/$|[.](/|$)'
   OR artifact->>'path' ~* '(^|/)(con|prn|aux|nul|com[1-9]|lpt[1-9])([.]|/|$)'
   THEN RAISE EXCEPTION 'EXACT_NORMALIZED_ARTIFACT_REQUIRED'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(m->'artifacts'))<>
    (SELECT count(DISTINCT lower(x->>'path')) FROM jsonb_array_elements(m->'artifacts') x)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(m->'operations') op
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'artifacts') a WHERE a->'operation'=op))
  THEN RAISE EXCEPTION 'UNIQUE_ARTIFACTS_FOR_EVERY_OPERATION_REQUIRED'; END IF;
 -- Hashes must be verified against actual artifact bytes by the host/executor.
 -- Later-created inventory/transfer results require a new exact manifest.
 SELECT * INTO c FROM thefa_native_host_v1.trusted_contexts_v1
  WHERE session_id=(p->>'session_id')::uuid AND grant_id=(p->>'grant_id')::uuid FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ENROLLED_NATIVE_CONTEXT_REQUIRED'; END IF;
 -- NORMAL_WRITE here is only the existing NativeHost authentication contract.
 -- The separate production manifest/policy above is the authorization boundary.
 IF c.revoked_at IS NOT NULL OR c.operation_kind<>'NORMAL_WRITE'
  OR c.context_hash IS DISTINCT FROM p->>'context_hash' OR c.scope IS DISTINCT FROM p->>'scope'
  OR c.payload_hash IS DISTINCT FROM p->>'payload_hash' OR c.source_ref IS DISTINCT FROM p->>'source_ref'
  OR c.approval_hash IS DISTINCT FROM b->>'source_message_hash'
  OR c.key_fingerprint IS DISTINCT FROM b->>'key_fingerprint'
  OR c.context#>>'{person,id}' IS DISTINCT FROM p->>'representative_person_id'
  OR c.context#>>'{key,id}' IS DISTINCT FROM b->>'key_id'
  OR c.context#>>'{key,actorRef}' IS DISTINCT FROM b->>'actor_ref'
  OR b->>'session_ref' IS DISTINCT FROM 'NATIVE_HOST_SESSION:'||c.session_id::text
  OR b->>'writer_grant_ref' IS DISTINCT FROM 'NATIVE_HOST_GRANT:'||c.grant_id::text
  THEN RAISE EXCEPTION 'NATIVE_CONTEXT_APPROVAL_BINDING_MISMATCH'; END IF;
 IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR jsonb_typeof(v) IS DISTINCT FROM 'object'
  OR proof->>'schema' IS DISTINCT FROM 'THE_FA_NATIVE_HOST_RECEIPT_SIGNATURE_V1'
  OR proof->>'issuer' IS DISTINCT FROM 'THE_FA_AUTHENTICATED_HOST'
  OR proof->>'algorithm' IS DISTINCT FROM 'Ed25519'
  OR proof->>'receipt_id' IS DISTINCT FROM p->>'receipt_id'
  OR proof->>'receipt_hash' IS DISTINCT FROM p->>'receipt_hash'
  OR proof->>'nonce_hash' IS DISTINCT FROM p->>'nonce_hash'
  OR proof->>'representative_person_id' IS DISTINCT FROM p->>'representative_person_id'
  OR proof->>'scope' IS DISTINCT FROM c.scope OR proof->>'payload_hash' IS DISTINCT FROM c.payload_hash
  OR proof->>'source_ref' IS DISTINCT FROM c.source_ref OR proof->>'key_id' IS DISTINCT FROM b->>'key_id'
  OR proof->>'actor_ref' IS DISTINCT FROM b->>'actor_ref'
  OR proof->>'issued_at' IS DISTINCT FROM p->>'issued_at' OR proof->>'expires_at' IS DISTINCT FROM p->>'expires_at'
  OR coalesce(proof->>'signature','') !~ '^[A-Za-z0-9_-]{86}$'
  OR v->>'verified_receipt_hash' IS DISTINCT FROM p->>'receipt_hash'
  OR v->>'native_session_id' IS DISTINCT FROM c.session_id::text OR v->>'grant_id' IS DISTINCT FROM c.grant_id::text
  OR v->>'approval_ref' IS DISTINCT FROM c.approval_ref OR v->>'approval_hash' IS DISTINCT FROM c.approval_hash
  OR v->>'public_key_fingerprint' IS DISTINCT FROM c.key_fingerprint
  OR v->>'key_id' IS DISTINCT FROM b->>'key_id'
  OR v->>'representative_person_id' IS DISTINCT FROM p->>'representative_person_id'
  OR v->>'scope' IS DISTINCT FROM c.scope OR v->>'payload_hash' IS DISTINCT FROM c.payload_hash
  OR v->>'source_ref' IS DISTINCT FROM c.source_ref
  OR v->'signature_verified' IS DISTINCT FROM 'true'::jsonb
  OR v->>'issuer' IS DISTINCT FROM 'THE_FA_AUTHENTICATED_HOST'
  OR v->'issuer_authenticated' IS DISTINCT FROM 'true'::jsonb
  OR v->'host_key_trust_verified' IS DISTINCT FROM 'true'::jsonb
  OR v->'native_session_verified' IS DISTINCT FROM 'true'::jsonb
  OR v->'representative_writer_grant_verified' IS DISTINCT FROM 'true'::jsonb
  OR v->'reader_grant_used' IS DISTINCT FROM 'false'::jsonb
  OR v->'nonce_consumed' IS DISTINCT FROM 'false'::jsonb
  OR v->'mutation_authority_granted' IS DISTINCT FROM 'false'::jsonb
  OR v->'write_allowed' IS DISTINCT FROM 'false'::jsonb THEN
  RAISE EXCEPTION 'PRESERVED_NATIVE_VERIFIER_EVIDENCE_MISMATCH'; END IF;
 FOREACH f IN ARRAY ARRAY['issued_at','expires_at'] LOOP
  IF p->>f !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   THEN RAISE EXCEPTION 'EXPLICIT_RECEIPT_TIMEZONE_REQUIRED'; END IF;
 END LOOP;
 IF jsonb_typeof(v->'verified_at') IS DISTINCT FROM 'string'
  OR coalesce(v->>'verified_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  THEN RAISE EXCEPTION 'EXPLICIT_VERIFICATION_TIMEZONE_REQUIRED'; END IF;
 IF NOT public.ceo_core_receipt_current_matches_v2(b) THEN RAISE EXCEPTION 'CURRENT_LEASE_FENCE_MISMATCH'; END IF;
 t:=clock_timestamp(); -- after context, Current and authoritative lease locks
 IF t<c.not_before OR t>=c.expires_at OR t<(p->>'issued_at')::timestamptz OR t>=(p->>'expires_at')::timestamptz
  OR (p->>'issued_at')::timestamptz<c.not_before OR (p->>'expires_at')::timestamptz>c.expires_at
  OR (p->>'expires_at')::timestamptz<=(p->>'issued_at')::timestamptz
  OR (p->>'expires_at')::timestamptz-(p->>'issued_at')::timestamptz>interval '2 minutes'
  OR (v->>'verified_at')::timestamptz<(p->>'issued_at')::timestamptz
  OR (v->>'verified_at')::timestamptz>t THEN RAISE EXCEPTION 'AUTHORIZATION_NOT_CURRENT'; END IF;
 RETURN m;
END $validate$;

CREATE FUNCTION thefa_customer_production_v1.retention_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'PRODUCTION_EVIDENCE_RETENTION_REQUIRED'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM thefa_native_host_v1.require_admin_v1();
  IF NEW.state<>'APPROVED' OR NEW.registered_at IS NOT NULL OR NEW.consumed_at IS NOT NULL OR NEW.revoked_at IS NOT NULL
   THEN RAISE EXCEPTION 'INITIAL_POLICY_STATE_REQUIRED'; END IF;
  PERFORM thefa_customer_production_v1.validate_policy_v1(NEW.policy);
  IF NEW.receipt_id IS DISTINCT FROM (NEW.policy->>'receipt_id')::uuid
   OR NEW.nonce_hash IS DISTINCT FROM NEW.policy->>'nonce_hash'
   OR NEW.payload_hash IS DISTINCT FROM NEW.policy->>'payload_hash'
   OR NEW.idempotency_key IS DISTINCT FROM NEW.policy#>>'{binding,idempotency_key}'
   OR NEW.session_id IS DISTINCT FROM (NEW.policy->>'session_id')::uuid
   OR NEW.grant_id IS DISTINCT FROM (NEW.policy->>'grant_id')::uuid
   OR NEW.context_hash IS DISTINCT FROM NEW.policy->>'context_hash'
   OR NEW.issued_at IS DISTINCT FROM (NEW.policy->>'issued_at')::timestamptz
   OR NEW.expires_at IS DISTINCT FROM (NEW.policy->>'expires_at')::timestamptz
   THEN RAISE EXCEPTION 'POLICY_COLUMNS_MUST_MATCH_EVIDENCE'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','registered_at','consumed_at','consumer_role','revoked_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','registered_at','consumed_at','consumer_role','revoked_at'])
   THEN RAISE EXCEPTION 'APPROVED_PRODUCTION_POLICY_IMMUTABLE'; END IF;
  IF OLD.state IN ('CONSUMED','EXPIRED','REVOKED') AND NEW IS DISTINCT FROM OLD
   THEN RAISE EXCEPTION 'TERMINAL_PRODUCTION_EVIDENCE_IMMUTABLE'; END IF;
  IF NEW.state<>OLD.state AND NOT ((OLD.state='APPROVED' AND NEW.state IN ('ISSUED','EXPIRED','REVOKED'))
   OR (OLD.state='ISSUED' AND NEW.state IN ('CONSUMED','EXPIRED','REVOKED')))
   THEN RAISE EXCEPTION 'PRODUCTION_STATE_TRANSITION_REJECTED'; END IF;
  IF OLD.registered_at IS NOT NULL AND NEW.registered_at IS DISTINCT FROM OLD.registered_at
   THEN RAISE EXCEPTION 'REGISTRATION_EVIDENCE_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER policy_retention BEFORE INSERT OR UPDATE OR DELETE ON thefa_customer_production_v1.policies_v1
 FOR EACH ROW EXECUTE FUNCTION thefa_customer_production_v1.retention_guard_v1();
CREATE TRIGGER policy_no_truncate BEFORE TRUNCATE ON thefa_customer_production_v1.policies_v1
 FOR EACH STATEMENT EXECUTE FUNCTION thefa_customer_production_v1.retention_guard_v1();

CREATE FUNCTION thefa_customer_production_v1.enroll_policy_v1(p_policy jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $enroll$
BEGIN
 PERFORM thefa_native_host_v1.require_admin_v1();
 PERFORM thefa_customer_production_v1.validate_policy_v1(p_policy);
 INSERT INTO thefa_customer_production_v1.policies_v1(receipt_id,nonce_hash,payload_hash,idempotency_key,
 session_id,grant_id,context_hash,policy,issued_at,expires_at) VALUES
 ((p_policy->>'receipt_id')::uuid,p_policy->>'nonce_hash',p_policy->>'payload_hash',p_policy#>>'{binding,idempotency_key}',
 (p_policy->>'session_id')::uuid,(p_policy->>'grant_id')::uuid,p_policy->>'context_hash',p_policy,
 (p_policy->>'issued_at')::timestamptz,(p_policy->>'expires_at')::timestamptz);
 RETURN jsonb_build_object('decision','CUSTOMER_PRODUCTION_POLICY_ENROLLED','receipt_id',p_policy->>'receipt_id',
 'payload_hash',p_policy->>'payload_hash','write_allowed',false);
END $enroll$;

CREATE FUNCTION thefa_customer_production_v1.register_v1(p_receipt_id uuid,p_nonce text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $register$
DECLARE p thefa_customer_production_v1.policies_v1%rowtype;
BEGIN
 PERFORM public.ceo_core_receipt_require_role_v2('thefa_core_receipt_issuer_v1');
 SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=p_receipt_id FOR UPDATE;
 IF NOT FOUND OR p.state<>'APPROVED' OR p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{64}$'
  OR p.nonce_hash IS DISTINCT FROM encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex') THEN
  RETURN jsonb_build_object('verified',false,'decision','CUSTOMER_PRODUCTION_RECEIPT_REJECTED','reason','EXACT_APPROVED_NONCE_REQUIRED','write_allowed',false); END IF;
 PERFORM thefa_customer_production_v1.validate_policy_v1(p.policy);
 UPDATE thefa_customer_production_v1.policies_v1 SET state='ISSUED',registered_at=clock_timestamp() WHERE receipt_id=p_receipt_id;
 RETURN jsonb_build_object('verified',true,'decision','CUSTOMER_PRODUCTION_RECEIPT_REGISTERED',
 'receipt_id',p.receipt_id,'receipt_hash',p.policy->>'receipt_hash','payload_hash',p.payload_hash,
 'idempotency_key',p.idempotency_key,'context_hash',p.context_hash,'write_allowed',false);
END $register$;

CREATE FUNCTION thefa_customer_production_v1.consume_v1(p_receipt_id uuid,p_nonce text,p_payload_hash text,p_idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $consume$
DECLARE p thefa_customer_production_v1.policies_v1%rowtype; m jsonb; t timestamptz;
BEGIN
 PERFORM public.ceo_core_receipt_require_role_v2('thefa_core_receipt_consumer_v1');
 SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=p_receipt_id FOR UPDATE;
 IF NOT FOUND OR p.state<>'ISSUED' OR p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{64}$'
  OR p.payload_hash IS DISTINCT FROM p_payload_hash OR p.idempotency_key IS DISTINCT FROM p_idempotency_key
  OR p.nonce_hash IS DISTINCT FROM encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex') THEN
  RETURN jsonb_build_object('verified',false,'decision','CUSTOMER_PRODUCTION_RECEIPT_REJECTED','reason','EXACT_ISSUED_BINDING_REQUIRED','write_allowed',false); END IF;
 m:=thefa_customer_production_v1.validate_policy_v1(p.policy);
 t:=clock_timestamp();
 IF t>=p.expires_at THEN RAISE EXCEPTION 'AUTHORIZATION_EXPIRED_AFTER_LOCKS'; END IF;
 UPDATE thefa_customer_production_v1.policies_v1 SET state='CONSUMED',consumed_at=t,
 consumer_role='thefa_core_receipt_consumer_v1' WHERE receipt_id=p_receipt_id;
 RETURN jsonb_build_object('verified',true,'decision','CUSTOMER_PRODUCTION_RECEIPT_CONSUMED','receipt_id',p.receipt_id,
 'receipt_hash',p.policy->>'receipt_hash','payload_hash',p.payload_hash,'manifest_hash',p.payload_hash,
 'idempotency_key',p.idempotency_key,'context_hash',p.context_hash,'binding',p.policy->'binding','target',m,
 'consumed_at',t,'write_allowed',false,'authority_boundary','CUSTOMER_PRODUCTION_ADMISSION_ONLY_WORK_UNIT_REQUIRED');
END $consume$;

CREATE FUNCTION thefa_customer_production_v1.readback_v1(p_receipt_id uuid,p_payload_hash text,p_idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $read$
DECLARE p thefa_customer_production_v1.policies_v1%rowtype;
BEGIN
 PERFORM public.ceo_core_receipt_require_role_v2('thefa_core_receipt_consumer_v1');
 SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=p_receipt_id
  AND payload_hash=p_payload_hash AND idempotency_key=p_idempotency_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('decision','CUSTOMER_PRODUCTION_RECEIPT_NOT_FOUND','write_allowed',false); END IF;
 RETURN jsonb_build_object('decision','CUSTOMER_PRODUCTION_RECEIPT_DATABASE_EVIDENCE','receipt_id',p.receipt_id,
 'receipt_hash',p.policy->>'receipt_hash','payload_hash',p.payload_hash,'manifest_hash',p.payload_hash,
 'idempotency_key',p.idempotency_key,'context_hash',p.context_hash,'binding',p.policy->'binding',
 'target',(p.policy->>'manifest_canonical')::jsonb,'state',p.state,'registered_at',p.registered_at,'consumed_at',p.consumed_at,
 'expires_at',p.expires_at,'consumer_role',p.consumer_role,'write_allowed',false,
 'authority_boundary','DATABASE_EVIDENCE_ONLY_NOT_EXECUTION_OR_TERMINAL_RECEIPT');
END $read$;

-- Clear inherited default ACLs on NEW objects only; existing privileges unchanged.
DO $acl$
DECLARE a record;
BEGIN
 FOR a IN SELECT c.relname,x.grantee FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 WHERE n.nspname='thefa_customer_production_v1' AND c.relkind='r' AND x.grantee<>c.relowner LOOP
  EXECUTE format('REVOKE ALL ON TABLE thefa_customer_production_v1.%I FROM %s',a.relname,
   CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
 END LOOP;
 FOR a IN SELECT p.oid::regprocedure AS signature,x.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
 WHERE n.nspname='thefa_customer_production_v1' AND x.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',a.signature,
   CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
 END LOOP;
END $acl$;
GRANT USAGE ON SCHEMA thefa_customer_production_v1 TO thefa_core_receipt_issuer_v1,thefa_core_receipt_consumer_v1;
GRANT EXECUTE ON FUNCTION thefa_customer_production_v1.register_v1(uuid,text) TO thefa_core_receipt_issuer_v1;
GRANT EXECUTE ON FUNCTION thefa_customer_production_v1.consume_v1(uuid,text,text,text),
 thefa_customer_production_v1.readback_v1(uuid,text,text) TO thefa_core_receipt_consumer_v1;
COMMENT ON SCHEMA thefa_customer_production_v1 IS 'Exact customer Production authentication admission; no provider mutation, Work Unit dispatch, Current update, old-job replay or cryptographic authentication in SQL.';
COMMIT;
