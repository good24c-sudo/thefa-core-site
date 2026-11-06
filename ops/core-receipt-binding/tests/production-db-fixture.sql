-- TEST_ONLY: isolated Docker consumer_qa database. Never run on a service DB.
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='thefa_core_receipt_issuer_v1') THEN CREATE ROLE thefa_core_receipt_issuer_v1 NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='thefa_core_receipt_consumer_v1') THEN CREATE ROLE thefa_core_receipt_consumer_v1 NOLOGIN NOINHERIT; END IF;
END $$;

CREATE FUNCTION public.test_rebind_manifest(p jsonb,m jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE h text:='sha256:'||encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex');
BEGIN
 UPDATE thefa_native_host_v1.trusted_contexts_v1 SET payload_hash=h WHERE session_id=(p->>'session_id')::uuid;
 p:=jsonb_set(p,'{manifest_canonical}',to_jsonb(m::text));
 p:=jsonb_set(p,'{payload_hash}',to_jsonb(h));
 p:=jsonb_set(p,'{proof,payload_hash}',to_jsonb(h));
 p:=jsonb_set(p,'{verification,payload_hash}',to_jsonb(h));
 RETURN p;
END $$;
CREATE SCHEMA thefa_native_host_v1;
CREATE TABLE thefa_native_host_v1.trusted_contexts_v1(
 session_id uuid,grant_id uuid,context jsonb,context_hash text,scope text,source_ref text,payload_hash text,
 approval_ref text,approval_hash text,key_fingerprint text,operation_kind text,
 not_before timestamptz,expires_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),revoked_at timestamptz,revocation_reason text,
 PRIMARY KEY(session_id,grant_id));
CREATE FUNCTION thefa_native_host_v1.require_admin_v1() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF session_user<>'postgres' OR coalesce(nullif(current_setting('role',true),''),'none')<>'none'
 THEN RAISE EXCEPTION 'NATIVE_ADMIN_ENROLLMENT_REQUIRED'; END IF; END $$;
CREATE FUNCTION public.ceo_core_receipt_require_role_v2(expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF coalesce(nullif(current_setting('role',true),'none'),session_user) IS DISTINCT FROM expected
 THEN RAISE EXCEPTION 'DEDICATED_RECEIPT_CALLER_REQUIRED'; END IF; END $$;
CREATE TABLE public.ceo_core_recovery_projection_v1(project_key text,room_family text,room_instance text,workstream_key text,
 is_current boolean,repository text,branch text,owning_issue text,current_head_sha text,work_identity_binding_hash text,ownership jsonb);
CREATE TABLE public.ceo_succession_work_lease_v1(idempotency_key text PRIMARY KEY,work_key text,repository text,branch text,
 head_sha text,active_writer text,fencing_generation bigint,bound_identity_fingerprint text);
-- TEST_ONLY fence primitive; real Current/lease checker is loaded verbatim from
-- representative_write_receipt_staging_v2.sql by the test runner.
CREATE FUNCTION public.ceo_core_validate_succession_writer_fence_v1(i text,h text,w text,f bigint) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('decision',CASE WHEN EXISTS(SELECT 1 FROM public.ceo_succession_work_lease_v1
 WHERE idempotency_key=i AND bound_identity_fingerprint=h AND active_writer=w AND fencing_generation=f)
 THEN 'WRITER_FENCE_VERIFIED' ELSE 'REJECTED' END) $$;
CREATE TABLE public.test_results(name text PRIMARY KEY,passed boolean NOT NULL);
CREATE FUNCTION public.test_assert(name text,result boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF result IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED:%',name; END IF;
 INSERT INTO public.test_results VALUES(name,true); END $$;

CREATE FUNCTION public.test_policy(name text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE sid uuid:=extensions.gen_random_uuid(); gid uuid:=extensions.gen_random_uuid(); rid uuid:=extensions.gen_random_uuid();
 person uuid:=extensions.gen_random_uuid(); ts timestamptz:=clock_timestamp(); stamp text; exp text; b jsonb;m jsonb;p jsonb;v jsonb;proof jsonb;
 ctx jsonb;ch text;ph text;nonce text:=encode(extensions.digest(convert_to(name,'UTF8'),'sha256'),'hex');
 source text:='CODEX_NATIVE_USER_MESSAGE:TEST_ONLY:'||name; scope text:='P04:00_v25:THE_FA_CORE_CUSTOMER_LAUNCH_V1';
BEGIN
 stamp:=to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 exp:=to_char((ts+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 b:=jsonb_build_object('actor_ref','actor_sha256:'||repeat('b',64),'audience','THE_FA_WORK_UNIT_API_V2',
 'branch','codex/core-customer-launch-v1-20261029','fencing_generation',1,'head_sha',repeat('a',40),'idempotency_key','TEST_'||name,
 'key_fingerprint','sha256:'||repeat('c',64),'key_id','test-key','operation_kind','CUSTOMER_PRODUCTION_AUTH',
 'owned_paths',jsonb_build_array('customer-public/**','infra/customer-launch/**','docs/customer-launch/**'),'owning_issue','#8',
 'project_key','P04','repository','good24c-sudo/thefa-core-site','room_family','00','room_instance','00_v25',
 'session_ref','NATIVE_HOST_SESSION:'||sid,'source_message_hash','sha256:'||repeat('d',64),'target_environment','PRODUCTION',
 'work_identity_binding_hash','sha256:'||repeat('e',64),'workstream_key','THE_FA_CORE_CUSTOMER_LAUNCH_V1',
 'writer_grant_ref','NATIVE_HOST_GRANT:'||gid,'writer_grant_revision',1,'writer_id','TEST_ONLY_WRITER',
 'writer_lease_idempotency_key','TEST_LEASE','writer_lease_work_key','TEST_WORK');
 m:=jsonb_build_object('contract','THE_FA_CUSTOMER_PRODUCTION_AUTH_V1','action','CUSTOMER_AUTH_PRODUCTION_CUTOVER',
 'environment','PRODUCTION','supabase_project_ref','cgrppxfdurpzzfvkmfte','vercel_project_id','prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',
 'origin','https://thefacore.com','operations',jsonb_build_array('INSTALL_AUTH_SCHEMA'),'preserve_data',true,'reset_usage_epoch',false,
 'replay_original_job',false,'protected_session_id','111c339990e7926f4e8b226e','expected_head',b->>'head_sha','idempotency_key',b->>'idempotency_key',
 'artifacts',jsonb_build_array(jsonb_build_object('operation','INSTALL_AUTH_SCHEMA','path','sql/auth.sql','sha256',repeat('1',64))));
 ph:='sha256:'||encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex');
 ctx:=jsonb_build_object('person',jsonb_build_object('id',person),'key',jsonb_build_object('id','test-key','actorRef',b->>'actor_ref'));
 ch:='sha256:'||encode(extensions.digest(convert_to(ctx::text,'UTF8'),'sha256'),'hex');
 INSERT INTO thefa_native_host_v1.trusted_contexts_v1 VALUES(sid,gid,ctx,ch,scope,source,ph,source,'sha256:'||repeat('d',64),
 'sha256:'||repeat('c',64),'NORMAL_WRITE',ts-interval '1 second',ts+interval '4 minutes',ts,NULL,NULL);
 DELETE FROM public.ceo_core_recovery_projection_v1;
 INSERT INTO public.ceo_core_recovery_projection_v1 VALUES('P04','00','00_v25','THE_FA_CORE_CUSTOMER_LAUNCH_V1',true,
 b->>'repository',b->>'branch','#8',b->>'head_sha',b->>'work_identity_binding_hash',jsonb_build_object('active_writer',b->>'writer_id',
 'fencing_generation',1,'owned_paths',b->'owned_paths','writer_lease_idempotency_key','TEST_LEASE','write_sealed',false));
 INSERT INTO public.ceo_succession_work_lease_v1 VALUES('TEST_LEASE','TEST_WORK',b->>'repository',b->>'branch',b->>'head_sha',
 b->>'writer_id',1,b->>'work_identity_binding_hash') ON CONFLICT(idempotency_key) DO UPDATE SET head_sha=excluded.head_sha,
 fencing_generation=excluded.fencing_generation,active_writer=excluded.active_writer;
 proof:=jsonb_build_object('schema','THE_FA_NATIVE_HOST_RECEIPT_SIGNATURE_V1','issuer','THE_FA_AUTHENTICATED_HOST','algorithm','Ed25519',
 'key_id','test-key','receipt_id',rid,'receipt_hash','sha256:'||repeat('f',64),'scope',scope,'payload_hash',ph,'source_ref',source,
 'representative_person_id',person,'nonce_hash',encode(extensions.digest(convert_to(nonce,'UTF8'),'sha256'),'hex'),
 'issued_at',stamp,'expires_at',exp,'actor_ref',b->>'actor_ref','signature',repeat('A',86));
 v:=jsonb_build_object('issuer','THE_FA_AUTHENTICATED_HOST','issuer_authenticated',true,'signature_verified',true,
 'host_key_trust_verified',true,'native_session_verified',true,'representative_writer_grant_verified',true,'reader_grant_used',false,
 'verified_receipt_hash','sha256:'||repeat('f',64),'representative_person_id',person,'scope',scope,'payload_hash',ph,'source_ref',source,
 'native_session_id',sid,'grant_id',gid,'key_id','test-key','public_key_fingerprint',b->>'key_fingerprint',
 'approval_ref',source,'approval_hash',b->>'source_message_hash','verified_at',stamp,'nonce_consumed',false,'write_allowed',false,'mutation_authority_granted',false);
 p:=jsonb_build_object('receipt_id',rid,'nonce_hash',proof->>'nonce_hash','receipt_hash',proof->>'receipt_hash',
 'representative_person_id',person,'scope',scope,'payload_hash',ph,'source_ref',source,'issued_at',stamp,'expires_at',exp,
 'session_id',sid,'grant_id',gid,'context_hash',ch,'binding',b,'manifest_canonical',m::text,'proof',proof,'verification',v);
 RETURN p;
END $$;

CREATE FUNCTION public.test_enrollment_rejected(name text,p jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN PERFORM thefa_customer_production_v1.enroll_policy_v1(p);
 EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 PERFORM public.test_assert(name,rejected);
END $$;
