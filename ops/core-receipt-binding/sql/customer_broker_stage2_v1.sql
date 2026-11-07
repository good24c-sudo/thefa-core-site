-- THE FA R72: REVIEW ONLY. DO NOT DEPLOY SQL ALONE.
-- Requires registered owner, NativeHost fresh receipt and Stage2 provider
-- exact source SHA plus live QA; original Stage1 contract preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION thefa_customer_broker_v1.live_policy_v1(p thefa_customer_production_v1.policies_v1, x jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ DECLARE t timestamptz; BEGIN
 IF p.state IS DISTINCT FROM 'CONSUMED' OR p.consumer_role IS DISTINCT FROM 'thefa_core_receipt_consumer_v1'
 OR p.consumed_at IS NULL OR p.consumed_at>=p.expires_at THEN RAISE EXCEPTION 'CONSUMED_NATIVE_POLICY_REQUIRED'; END IF;
 PERFORM thefa_customer_production_v1.validate_policy_v1(p.policy);
 t:=clock_timestamp();
 IF t>=p.expires_at OR x->>'_server_fresh_head' IS DISTINCT FROM p.policy#>>'{binding,head_sha}'
 OR jsonb_typeof(x->'_server_observed_at') IS DISTINCT FROM 'string'
 OR (x->>'_server_observed_at')::timestamptz>t
 OR (x->>'_server_observed_at')::timestamptz<t-interval '30 seconds'
 THEN RAISE EXCEPTION 'FRESH_SOURCE_AND_LIVE_AUTHORITY_REQUIRED'; END IF;
 IF (p.policy->>'manifest_canonical')::jsonb->'operations' NOT IN (
      '["INSTALL_AUTH_SCHEMA"]'::jsonb,
      '["CONFIGURE_CUSTOMER_AUTH_ENV"]'::jsonb
    )
 THEN RAISE EXCEPTION 'CUSTOMER_BROKER_OPERATION_NOT_ADMITTED'; END IF;
END; $function$;
REVOKE ALL ON FUNCTION thefa_customer_broker_v1.live_policy_v1(thefa_customer_production_v1.policies_v1,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.ceo_core_customer_broker_v1(p_mode text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE x jsonb:=p_payload; m text:=p_mode; p thefa_customer_production_v1.policies_v1%rowtype;
 u thefa_customer_broker_v1.work_units_v1%rowtype; a public.ceo_core_guarded_action_ledger%rowtype;
 c thefa_customer_broker_v1.worker_claims_v1%rowtype; pr thefa_customer_broker_v1.provider_results_v1%rowtype;
 ar thefa_customer_broker_v1.authorities_v1%rowtype; cr public.ceo_core_guarded_action_receipts%rowtype;
 b jsonb; manifest jsonb; commitment jsonb; h text; intent jsonb; result jsonb; authority jsonb;
 aid uuid; wid text; reused boolean:=false; t timestamptz; provider_hash text; operation_id text;
 rb jsonb; role_info jsonb; expected_tables text[]:=ARRAY['core_customer_auth.account','core_customer_auth.session','core_customer_auth.user','core_customer_auth.verification','public.core_console_artifacts_v3','public.core_console_state_v3'];
BEGIN
 IF coalesce(nullif(current_setting('role',true),'none'),session_user)<>'service_role'
 THEN RAISE EXCEPTION 'AUTHENTICATED_SERVICE_CALLER_REQUIRED'; END IF;
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR octet_length(x::text)>200000
 THEN RAISE EXCEPTION 'BOUNDED_OBJECT_REQUIRED'; END IF;
 IF m='GET_VALIDATION_CONTEXT_V1' THEN
  IF x->>'receipt_id' IS NOT NULL THEN SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=(x->>'receipt_id')::uuid;
  ELSIF x->>'action_id' IS NOT NULL THEN
   SELECT * INTO a FROM public.ceo_core_guarded_action_ledger WHERE action_id=(x->>'action_id')::uuid;
   SELECT * INTO u FROM thefa_customer_broker_v1.work_units_v1 WHERE 'customer-workunit:'||work_unit_id=a.context_lease_id;
   SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=u.receipt_id;
  ELSE SELECT * INTO u FROM thefa_customer_broker_v1.work_units_v1 WHERE work_unit_id=x->>'work_unit_id' OR 'customer-workunit:'||work_unit_id=x->>'context_lease_id';
   SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=u.receipt_id; END IF;
  IF p.receipt_id IS NULL THEN RAISE EXCEPTION 'ADMISSION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('receipt_id',p.receipt_id,'core_binding',p.policy->'binding','manifest',(p.policy->>'manifest_canonical')::jsonb,'expires_at',p.expires_at);
 END IF;
 IF m='ADMIT_WORK_UNIT_V1' THEN
  wid:=x->>'work_unit_id';
  IF coalesce(wid,'')!~'^dcjob-[0-9a-f]{24}$' THEN RAISE EXCEPTION 'CANONICAL_WORK_UNIT_ID_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(wid,7711));
  SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=(x->>'receipt_id')::uuid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADMISSION_NOT_FOUND'; END IF;
  IF wid IS DISTINCT FROM 'dcjob-'||substring(encode(extensions.digest(convert_to(
   (p.policy#>>'{binding,project_key}')||'|'||(p.policy#>>'{binding,room_instance}')||'|'||
   (p.policy#>>'{binding,workstream_key}')||'|'||p.idempotency_key,'UTF8'),'sha256'),'hex') FROM 1 FOR 24)
  THEN RAISE EXCEPTION 'CANONICAL_WORK_UNIT_ID_BINDING_REQUIRED'; END IF;
  commitment:=jsonb_build_object('work_unit_id',wid,'receipt_id',x->'receipt_id','payload_hash',x->'payload_hash',
   'idempotency_key',x->'idempotency_key','runtime_identity',x->'runtime_identity','manifest',x->'manifest','core_binding',x->'core_binding');
  h:=thefa_customer_broker_v1.hash_v1(commitment);
  IF x->>'payload_hash' IS DISTINCT FROM p.payload_hash OR x->>'idempotency_key' IS DISTINCT FROM p.idempotency_key
   OR x->'manifest' IS DISTINCT FROM (p.policy->>'manifest_canonical')::jsonb OR x->'core_binding' IS DISTINCT FROM p.policy->'binding'
   OR x->'runtime_identity' IS DISTINCT FROM '{"adapter_instance_id":"THEFA_PROVIDER_HOST_4060_V1","adapter_epoch":1}'::jsonb
   OR x->>'request_binding_hash' IS DISTINCT FROM h THEN RAISE EXCEPTION 'EXACT_WORK_UNIT_COMMITMENT_REQUIRED'; END IF;
  SELECT * INTO u FROM thefa_customer_broker_v1.work_units_v1 WHERE work_unit_id=wid;
  IF FOUND THEN
   IF u.receipt_id<>p.receipt_id OR u.request_binding_hash<>h OR u.request_commitment<>commitment
   THEN RAISE EXCEPTION 'WORK_UNIT_IDEMPOTENCY_CONFLICT'; END IF;
   reused:=true;
  ELSE
   PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
   INSERT INTO thefa_customer_broker_v1.work_units_v1(work_unit_id,receipt_id,request_binding_hash,request_commitment)
    VALUES(wid,p.receipt_id,h,commitment) RETURNING * INTO u;
  END IF;
  intent:=thefa_customer_broker_v1.intent_v1(u,p);
  RETURN jsonb_build_object('decision','PROVIDER_WORK_UNIT_REGISTERED','reused',reused,'work_unit_id',wid,
   'request_binding_hash',h,'admission_receipt_hash',p.policy->>'receipt_hash','expires_at',p.expires_at,
   'core_binding',p.policy->'binding','broker_prepare_request',jsonb_build_object('action','prepare_guarded_action',
   'adapter_provider','CODEX','runtime_identity',x->'runtime_identity','context_lease_id','customer-workunit:'||wid,
   'action_type','RISKY_OPERATIONAL_DATA_CHANGE','target_provider','SUPABASE','intent',intent,'idempotency_key',p.idempotency_key));
 END IF;
 IF m IN ('PREPARE_CONTEXT_V1','GET_PROVIDER_WORK_UNIT_V1') THEN
  wid:=CASE WHEN m='PREPARE_CONTEXT_V1' THEN substring(x->>'context_lease_id' FROM 19) ELSE x->>'work_unit_id' END;
  SELECT * INTO u FROM thefa_customer_broker_v1.work_units_v1 WHERE work_unit_id=wid;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTERED_WORK_UNIT_REQUIRED'; END IF;
  SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=u.receipt_id FOR SHARE;
  b:=p.policy->'binding'; intent:=thefa_customer_broker_v1.intent_v1(u,p);
  IF m='PREPARE_CONTEXT_V1' THEN
   PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
   IF x->>'context_lease_id' IS DISTINCT FROM 'customer-workunit:'||wid OR x->'intent' IS DISTINCT FROM intent
    OR x->>'idempotency_key' IS DISTINCT FROM p.idempotency_key OR x->>'action_type' IS DISTINCT FROM 'RISKY_OPERATIONAL_DATA_CHANGE'
    OR x->>'target_provider' IS DISTINCT FROM 'SUPABASE' OR x->'runtime_identity' IS DISTINCT FROM u.request_commitment->'runtime_identity'
   THEN RAISE EXCEPTION 'EXACT_PREPARE_CONTEXT_REQUIRED'; END IF;
   RETURN jsonb_build_object('decision','PREPARE_CONTEXT_VERIFIED','risk_class','RED','work_identity_binding_hash',b->'work_identity_binding_hash',
    'adapter_instance_id','THEFA_PROVIDER_HOST_4060_V1','adapter_epoch',1,'owned_paths',b->'owned_paths','expected_parent_head',NULL);
  END IF;
  SELECT * INTO a FROM public.ceo_core_guarded_action_ledger WHERE context_lease_id='customer-workunit:'||wid
    AND work_identity_binding_hash=b->>'work_identity_binding_hash' AND idempotency_key=p.idempotency_key AND target_provider='SUPABASE';
  IF a.action_id IS NOT NULL AND (a.intent IS DISTINCT FROM intent OR a.risk_class<>'RED' OR a.action_type<>'RISKY_OPERATIONAL_DATA_CHANGE'
   OR a.adapter_instance_id<>'THEFA_PROVIDER_HOST_4060_V1' OR a.adapter_epoch<>1 OR a.owned_paths IS DISTINCT FROM b->'owned_paths'
   OR a.expected_parent_head IS NOT NULL) THEN RAISE EXCEPTION 'WORK_UNIT_ACTION_BINDING_MISMATCH'; END IF;
  SELECT * INTO cr FROM public.ceo_core_guarded_action_receipts WHERE action_id=a.action_id AND attempt_id=a.last_attempt_id;
  SELECT * INTO pr FROM thefa_customer_broker_v1.provider_results_v1 WHERE action_id=a.action_id;
  result:=jsonb_build_object('decision','PROVIDER_WORK_UNIT_READBACK','work_unit_id',wid,'action_id',a.action_id,
   'request_binding_hash',u.request_binding_hash,'admission_receipt_hash',p.policy->>'receipt_hash','prepared_action_hash',a.prepared_action_hash,
   'expires_at',p.expires_at,'core_binding',b,'state',coalesce(a.state,'REGISTERED_ACTION_PENDING'),'work_unit_accepted',a.action_id IS NOT NULL,
   'development_complete',false,'provider_terminal_verified',false,'blind_redispatch_allowed',false);
  IF a.state='COMPLETED' THEN
   IF cr.receipt_id IS NULL OR pr.action_id IS NULL OR cr.result_binding_hash IS DISTINCT FROM a.result_binding_hash
    OR cr.provider_receipt_hash IS DISTINCT FROM pr.provider_result->>'provider_receipt_hash'
    OR cr.authority_receipt_hash IS DISTINCT FROM a.authority_receipt_hash OR cr.fencing_generation IS DISTINCT FROM a.fencing_generation
   THEN RAISE EXCEPTION 'EXACT_PROVIDER_TERMINAL_RECEIPT_REQUIRED'; END IF;
   result:=result||jsonb_build_object('provider_terminal_verified',true,'result_binding_hash',cr.result_binding_hash,
    'provider_receipt_hash',cr.provider_receipt_hash,'provider_operation_id',cr.provider_operation_id,'provider_receipt_id',cr.receipt_id);
  END IF; RETURN result;
 END IF;
 aid:=coalesce(x->>'action_id',x#>>'{action,action_id}')::uuid;
 SELECT * INTO a FROM public.ceo_core_guarded_action_ledger WHERE action_id=aid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXACT_BROKER_ACTION_REQUIRED'; END IF;
 SELECT * INTO u FROM thefa_customer_broker_v1.work_units_v1 WHERE 'customer-workunit:'||work_unit_id=a.context_lease_id;
 SELECT * INTO p FROM thefa_customer_production_v1.policies_v1 WHERE receipt_id=u.receipt_id FOR SHARE;
 b:=p.policy->'binding'; manifest:=(p.policy->>'manifest_canonical')::jsonb;
 IF u.work_unit_id IS NULL OR p.receipt_id IS NULL OR a.intent IS DISTINCT FROM thefa_customer_broker_v1.intent_v1(u,p)
  OR a.work_identity_binding_hash IS DISTINCT FROM b->>'work_identity_binding_hash' OR a.target_provider<>'SUPABASE'
  OR a.risk_class<>'RED' OR a.action_type<>'RISKY_OPERATIONAL_DATA_CHANGE' OR a.idempotency_key<>p.idempotency_key
  OR a.adapter_instance_id<>'THEFA_PROVIDER_HOST_4060_V1' OR a.adapter_epoch<>1 OR a.owned_paths IS DISTINCT FROM b->'owned_paths'
  OR a.expected_parent_head IS NOT NULL THEN RAISE EXCEPTION 'EXACT_REGISTERED_CUSTOMER_ACTION_REQUIRED'; END IF;
 IF m='EXECUTE_AUTHORITY_V1' THEN
  PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
  IF a.state NOT IN ('PREPARED','AUTHORIZED') OR a.attempt_count<>0
   OR x->>'prepared_action_hash' IS DISTINCT FROM a.prepared_action_hash
   OR x->>'work_identity_binding_hash' IS DISTINCT FROM a.work_identity_binding_hash
   OR x->'runtime_identity' IS DISTINCT FROM u.request_commitment->'runtime_identity'
  THEN RAISE EXCEPTION 'EXACT_FIRST_EXECUTION_AUTHORITY_REQUIRED'; END IF;
  SELECT * INTO ar FROM thefa_customer_broker_v1.authorities_v1 WHERE action_id=aid;
  IF FOUND THEN RETURN ar.authority; END IF;
  t:=clock_timestamp();
  authority:=jsonb_build_object('authority_receipt_id',gen_random_uuid(),'action_id',aid,'prepared_action_hash',a.prepared_action_hash,
   'work_identity_binding_hash',a.work_identity_binding_hash,'adapter_instance_id',a.adapter_instance_id,'adapter_epoch',a.adapter_epoch,
   'writer_lease_id',b->>'writer_lease_idempotency_key','fencing_generation',(b->>'fencing_generation')::bigint,
   'fresh_source_binding_hash',thefa_customer_broker_v1.hash_v1(jsonb_build_object('head',b->'head_sha','work_unit_commitment',u.request_binding_hash)),
   'policy_revision','CUSTOMER_BROKER_RUNTIME_V1','issued_at',t,'expires_at',p.expires_at,
   'fresh_source_exact',true,'writer_lease_active',true,'server_principal_verified',true,'policy_allowed',true,
   'stale_adapter_epoch_rejected',true,'fresh_head',b->'head_sha','owned_paths_hash',a.owned_paths_hash,
   'representative_approval_verified',true,'representative_approval_scope_hash',p.payload_hash);
  authority:=authority||jsonb_build_object('receipt_hash',thefa_customer_broker_v1.hash_v1(authority));
  INSERT INTO thefa_customer_broker_v1.authorities_v1(action_id,authority) VALUES(aid,authority);
  RETURN authority;
 END IF;
 SELECT * INTO ar FROM thefa_customer_broker_v1.authorities_v1 WHERE action_id=aid;
 IF ar.action_id IS NULL OR a.authority_receipt_hash IS DISTINCT FROM ar.authority->>'receipt_hash'
  OR a.fencing_generation IS DISTINCT FROM (b->>'fencing_generation')::bigint
  OR a.attempt_count<>1 OR a.last_attempt_id IS NULL THEN RAISE EXCEPTION 'CLAIMED_BROKER_AUTHORITY_REQUIRED'; END IF;
 provider_hash:=thefa_customer_broker_v1.hash_v1(thefa_customer_broker_v1.provider_payload_v1(a));
 operation_id:='supabase:cgrppxfdurpzzfvkmfte:'||aid;
 IF m='PROVIDER_ACCEPT' THEN
  PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
  IF a.state<>'DISPATCHING' OR (x-'_server_fresh_head'-'_server_observed_at') IS DISTINCT FROM thefa_customer_broker_v1.provider_payload_v1(a)
   THEN RAISE EXCEPTION 'EXACT_PROVIDER_PAYLOAD_REQUIRED'; END IF;
  RETURN jsonb_build_object('kind','ACCEPTED_RECEIPT_PENDING','provider_operation_id',operation_id,'provider_request_hash',provider_hash);
 END IF;
 IF m='WORKER_CLAIM' THEN
  PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
  IF a.state NOT IN ('DISPATCHING','RECEIPT_PENDING') THEN RAISE EXCEPTION 'WORKER_CLAIM_STATE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM thefa_customer_broker_v1.worker_claims_v1 WHERE action_id=aid)
   THEN RETURN jsonb_build_object('decision','BLOCKED_WORKER_ALREADY_CLAIMED','action_id',aid,'blind_redispatch_allowed',false); END IF;
  INSERT INTO thefa_customer_broker_v1.worker_claims_v1(action_id,provider_request_hash,provider_operation_id,expires_at)
    VALUES(aid,provider_hash,operation_id,p.expires_at) RETURNING * INTO c;
  RETURN jsonb_build_object('decision','WORKER_CLAIMED','action_id',aid,'claim_id',c.claim_id,'work_unit_id',u.work_unit_id,
   'receipt_id',p.receipt_id,'manifest',manifest,'core_binding',b,'provider_request_hash',provider_hash,'provider_operation_id',operation_id,
   'authority_receipt_hash',a.authority_receipt_hash,'fencing_generation',a.fencing_generation,
   'request_binding_hash',u.request_binding_hash,'admission_receipt_hash',p.policy->>'receipt_hash',
   'sql_sha256',(SELECT sql_sha256 FROM thefa_customer_broker_v1.runtime_config_v1),'expires_at',c.expires_at);
 END IF;
 SELECT * INTO c FROM thefa_customer_broker_v1.worker_claims_v1 WHERE action_id=aid;
 SELECT * INTO pr FROM thefa_customer_broker_v1.provider_results_v1 WHERE action_id=aid;
 IF m='WORKER_VALIDATE' THEN
  PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
  IF manifest->'operations' IS DISTINCT FROM '["CONFIGURE_CUSTOMER_AUTH_ENV"]'::jsonb
   OR NOT thefa_customer_production_v1.exact_keys_v1(x-'_server_fresh_head'-'_server_observed_at',ARRAY['action_id','claim_id'])
   OR c.action_id IS NULL OR x->>'claim_id' IS DISTINCT FROM c.claim_id::text
   OR c.provider_request_hash IS DISTINCT FROM provider_hash OR c.provider_operation_id IS DISTINCT FROM operation_id
   OR c.expires_at<=clock_timestamp() OR a.state NOT IN ('DISPATCHING','RECEIPT_PENDING') OR pr.action_id IS NOT NULL
  THEN RAISE EXCEPTION 'EXACT_LIVE_STAGE2_WORKER_CLAIM_REQUIRED'; END IF;
  RETURN jsonb_build_object('decision','WORKER_CLAIM_VERIFIED','action_id',aid,'claim_id',c.claim_id,
   'attempt_id',a.last_attempt_id,'work_unit_id',u.work_unit_id,'receipt_id',p.receipt_id,
   'provider_request_hash',provider_hash,'provider_operation_id',operation_id,
   'request_binding_hash',u.request_binding_hash,'admission_receipt_hash',p.policy->>'receipt_hash',
   'expires_at',c.expires_at,'core_binding',b,'manifest',manifest,'policy_state',p.state,
   'consumer_role',p.consumer_role,'consumed_at',p.consumed_at,'observed_at',clock_timestamp());
 END IF;
  IF m='WORKER_RESULT' THEN
   IF manifest->'operations'='["CONFIGURE_CUSTOMER_AUTH_ENV"]'::jsonb THEN
    -- The same service_role caller, Core writer fence, single claim, NativeHost
    -- policy and guarded-action receipt contract as Stage1 are reused.
    -- No "worker completed" flag from request JSON may bypass readback.
    IF NOT thefa_customer_production_v1.exact_keys_v1(x-'_server_fresh_head'-'_server_observed_at',ARRAY[
      'action_id','claim_id','provider_request_hash','provider_operation_id',
      'artifact_hashes','operation_code_sha256','readback','observed_at'])
     OR c.action_id IS NULL OR x->>'claim_id' IS DISTINCT FROM c.claim_id::text
     OR x->>'provider_request_hash' IS DISTINCT FROM c.provider_request_hash
     OR x->>'provider_operation_id' IS DISTINCT FROM c.provider_operation_id
     OR x->'artifact_hashes' IS DISTINCT FROM manifest->'artifacts'
     OR x->>'operation_code_sha256' IS DISTINCT FROM manifest#>>'{artifacts,0,sha256}'
     OR jsonb_array_length(manifest->'artifacts') IS DISTINCT FROM 1
     OR coalesce(x->>'operation_code_sha256','') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(x->'observed_at') IS DISTINCT FROM 'string'
     OR (x->>'observed_at')::timestamptz<c.claimed_at
     OR (x->>'observed_at')::timestamptz>clock_timestamp()
     OR (x->>'observed_at')::timestamptz>c.expires_at
    THEN RAISE EXCEPTION 'EXACT_AUTH_ENV_CLAIMED_PROVIDER_RESULT_REQUIRED'; END IF;
    rb:=x->'readback';
    IF NOT thefa_customer_production_v1.exact_keys_v1(rb,ARRAY[
      'project_ref','runtime_role','runtime_login','vercel'])
     OR rb->>'project_ref' IS DISTINCT FROM 'cgrppxfdurpzzfvkmfte'
     OR rb->'runtime_role' IS DISTINCT FROM
      '{"name":"core_customer_auth_runtime","can_login":true,
        "superuser":false,"bypass_rls":false,"create_db":false,
        "create_role":false,"replication":false,
        "password_is_null":false,"scram_verifier_present":true}'::jsonb
     OR NOT thefa_customer_production_v1.exact_keys_v1(rb->'runtime_login',ARRAY[
      'db_role','scram_authenticated','tls_verified','verified_at'])
     OR rb#>>'{runtime_login,db_role}' IS DISTINCT FROM 'core_customer_auth_runtime'
     OR rb#>'{runtime_login,scram_authenticated}' IS DISTINCT FROM 'true'::jsonb
     OR rb#>'{runtime_login,tls_verified}' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(rb#>'{runtime_login,verified_at}') IS DISTINCT FROM 'string'
     OR (rb#>>'{runtime_login,verified_at}')::timestamptz<c.claimed_at
     OR (rb#>>'{runtime_login,verified_at}')::timestamptz>(x->>'observed_at')::timestamptz
     OR NOT thefa_customer_production_v1.exact_keys_v1(rb->'vercel',ARRAY[
      'project_id','target','database_secret_encrypted','server_readback_verified'])
     OR rb#>>'{vercel,project_id}' IS DISTINCT FROM 'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo'
     OR rb#>>'{vercel,target}' IS DISTINCT FROM 'production'
     OR rb#>'{vercel,database_secret_encrypted}' IS DISTINCT FROM 'true'::jsonb
     OR rb#>'{vercel,server_readback_verified}' IS DISTINCT FROM 'true'::jsonb
    THEN RAISE EXCEPTION 'EXACT_AUTH_ENV_RUNTIME_AND_VERCEL_READBACK_REQUIRED'; END IF;
    IF pr.action_id IS NOT NULL THEN
     IF (pr.result_input-'_server_fresh_head'-'_server_observed_at') IS DISTINCT FROM
        (x-'_server_fresh_head'-'_server_observed_at') THEN
      RAISE EXCEPTION 'PROVIDER_RESULT_IMMUTABLE_CONFLICT'; END IF;
     RETURN pr.provider_result||jsonb_build_object(
       'decision','DUPLICATE_PROVIDER_RESULT_NOOP');
    END IF;
    PERFORM thefa_customer_broker_v1.live_policy_v1(p,x);
    result:=jsonb_build_object('kind','VERIFIED_RECEIPT','provider','SUPABASE',
      'action_id',aid,'work_unit_id',u.work_unit_id,
      'claim_id',c.claim_id,'admission_receipt_hash',p.policy->>'receipt_hash',
      'provider_operation_id',operation_id,'provider_request_hash',provider_hash,
      'authority_receipt_hash',a.authority_receipt_hash,
      'fencing_generation',a.fencing_generation,
      'receipt_metadata',jsonb_build_object(
       'operation', 'CONFIGURE_CUSTOMER_AUTH_ENV',
       'operation_code_sha256',x->>'operation_code_sha256',
       'catalog_hash',thefa_customer_broker_v1.hash_v1(rb),
       'observed_at',x->>'observed_at',
       'work_unit_id',u.work_unit_id,'payload_hash',p.payload_hash));
    h:=thefa_customer_broker_v1.hash_v1(result);
    result:=result||jsonb_build_object('provider_receipt_hash',h,
      'result_binding_hash',thefa_customer_broker_v1.hash_v1(jsonb_build_object(
       'action_id',aid,'work_unit_id',u.work_unit_id,
       'provider_receipt_hash',h,'request_binding_hash',u.request_binding_hash)));
    INSERT INTO thefa_customer_broker_v1.provider_results_v1(
      action_id,result_input,provider_result) VALUES(aid,x,result);
    RETURN result||jsonb_build_object('decision','PROVIDER_RESULT_RECORDED');
   END IF;
  IF NOT thefa_customer_production_v1.exact_keys_v1(x,ARRAY['action_id','claim_id','provider_request_hash','provider_operation_id','artifact_hashes','sql_sha256','readback','observed_at'])
   OR c.action_id IS NULL OR x->>'claim_id' IS DISTINCT FROM c.claim_id::text
   OR x->>'provider_request_hash' IS DISTINCT FROM c.provider_request_hash OR x->>'provider_operation_id' IS DISTINCT FROM c.provider_operation_id
   OR x->'artifact_hashes' IS DISTINCT FROM manifest->'artifacts'
   OR x->>'sql_sha256' IS DISTINCT FROM (SELECT sql_sha256 FROM thefa_customer_broker_v1.runtime_config_v1)
   OR jsonb_typeof(x->'observed_at') IS DISTINCT FROM 'string' OR (x->>'observed_at')::timestamptz<c.claimed_at
   OR (x->>'observed_at')::timestamptz>clock_timestamp()
  THEN RAISE EXCEPTION 'EXACT_CLAIMED_PROVIDER_RESULT_REQUIRED'; END IF;
  rb:=x->'readback'; role_info:=rb->'runtime_role';
  IF rb->>'project_ref' IS DISTINCT FROM 'cgrppxfdurpzzfvkmfte' OR jsonb_typeof(rb->'tables') IS DISTINCT FROM 'array'
   OR (SELECT array_agg(v->>'schema'||'.'||(v->>'name') ORDER BY v->>'schema'||'.'||(v->>'name')) FROM jsonb_array_elements(rb->'tables') v) IS DISTINCT FROM expected_tables
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(rb->'tables') v WHERE v->'rls_enabled' IS DISTINCT FROM 'true'::jsonb OR v->'force_rls' IS DISTINCT FROM 'true'::jsonb)
   OR role_info IS DISTINCT FROM '{"name":"core_customer_auth_runtime","can_login":true,"superuser":false,"bypass_rls":false,"create_db":false,"create_role":false,"replication":false,"password_is_null":true}'::jsonb
  THEN RAISE EXCEPTION 'EXACT_CUSTOMER_CATALOG_READBACK_REQUIRED'; END IF;
  IF pr.action_id IS NOT NULL THEN
   IF pr.result_input IS DISTINCT FROM x THEN RAISE EXCEPTION 'PROVIDER_RESULT_IMMUTABLE_CONFLICT'; END IF;
   RETURN pr.provider_result||jsonb_build_object('decision','DUPLICATE_PROVIDER_RESULT_NOOP');
  END IF;
  result:=jsonb_build_object('kind','VERIFIED_RECEIPT','provider','SUPABASE','action_id',aid,'work_unit_id',u.work_unit_id,
   'claim_id',c.claim_id,'admission_receipt_hash',p.policy->>'receipt_hash',
   'provider_operation_id',operation_id,'provider_request_hash',provider_hash,'authority_receipt_hash',a.authority_receipt_hash,
   'fencing_generation',a.fencing_generation,'receipt_metadata',jsonb_build_object('sql_sha256',x->>'sql_sha256',
   'catalog_hash',thefa_customer_broker_v1.hash_v1(rb),'observed_at',x->>'observed_at','work_unit_id',u.work_unit_id,'payload_hash',p.payload_hash));
  h:=thefa_customer_broker_v1.hash_v1(result);
  result:=result||jsonb_build_object('provider_receipt_hash',h,'result_binding_hash',thefa_customer_broker_v1.hash_v1(jsonb_build_object(
   'action_id',aid,'work_unit_id',u.work_unit_id,'provider_receipt_hash',h,'request_binding_hash',u.request_binding_hash)));
  INSERT INTO thefa_customer_broker_v1.provider_results_v1(action_id,result_input,provider_result) VALUES(aid,x,result);
  RETURN result||jsonb_build_object('decision','PROVIDER_RESULT_RECORDED');
 END IF;
 IF m='READBACK_ACTION_V1' THEN
  IF x->>'intent_hash' IS DISTINCT FROM a.intent_hash OR x->>'authority_receipt_hash' IS DISTINCT FROM a.authority_receipt_hash
   OR x->'fencing_generation' IS DISTINCT FROM to_jsonb(a.fencing_generation) OR x->>'target_provider' IS DISTINCT FROM 'SUPABASE'
   OR x->>'provider_idempotency_key' IS DISTINCT FROM 'thefa:'||aid||':'||a.idempotency_key THEN RAISE EXCEPTION 'EXACT_READBACK_BINDING_REQUIRED'; END IF;
  RETURN CASE WHEN pr.action_id IS NULL THEN jsonb_build_object('status','UNKNOWN','blind_redispatch_allowed',false)
   ELSE jsonb_build_object('status','APPLIED_VERIFIED','provider_result',pr.provider_result) END;
 END IF;
 IF m='VERIFY_PROVIDER_RECEIPT_V1' THEN
  IF pr.action_id IS NULL OR x->'provider_result' IS DISTINCT FROM pr.provider_result
   OR x#>>'{authority_reference,receipt_hash}' IS DISTINCT FROM a.authority_receipt_hash
   OR x#>'{authority_reference,fencing_generation}' IS DISTINCT FROM to_jsonb(a.fencing_generation)
   OR x#>>'{action,prepared_action_hash}' IS DISTINCT FROM a.prepared_action_hash
   OR x#>'{action,intent}' IS DISTINCT FROM a.intent THEN RAISE EXCEPTION 'EXACT_STORED_PROVIDER_RECEIPT_REQUIRED'; END IF;
  RETURN pr.provider_result||jsonb_build_object('verified',true);
 END IF;
 RAISE EXCEPTION 'CUSTOMER_BROKER_MODE_NOT_ALLOWED';
END; $function$;
REVOKE ALL ON FUNCTION public.ceo_core_customer_broker_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ceo_core_customer_broker_v1(text,jsonb) TO service_role;
COMMIT;
