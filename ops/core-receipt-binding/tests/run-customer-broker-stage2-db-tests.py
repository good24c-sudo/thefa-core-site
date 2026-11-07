"""Local PostgreSQL only. Native signatures remain TEST_ONLY fixture evidence.
Runs the unchanged Stage1 assertions against the compatible Stage2 release,
then exercises Stage2 enrollment through the real policy and Broker functions.
No validate_policy stub, replication override or live service connections.
"""
from pathlib import Path
import os
import runpy

os.environ['THEFA_QA_STAGE2']='1'
g=runpy.run_path(str(Path(__file__).with_name('run-customer-broker-db-tests.py')))
globals().update({k:v for k,v in g.items() if not k.startswith('__')})
stage1_count=len(checks)
stage1_job=wid
p=one("SELECT public.test_policy('stage2_valid');")
manifest=__import__('json').loads(p['manifest_canonical'])
manifest['operations']=['CONFIGURE_CUSTOMER_AUTH_ENV']
manifest['artifacts']=[dict(operation='CONFIGURE_CUSTOMER_AUTH_ENV',path='infra/customer-launch/runtime/auth-env.mjs',sha256='a'*64)]
p=one('SELECT public.test_rebind_manifest('+literal(p)+','+literal(manifest)+');')
nonce=hashlib.sha256(b'stage2_valid').hexdigest()
query("SELECT thefa_customer_production_v1.enroll_policy_v1("+literal(p)+");SET ROLE thefa_core_receipt_issuer_v1;SELECT thefa_customer_production_v1.register_v1('"+p['receipt_id']+"','"+nonce+"');RESET ROLE;SET ROLE thefa_core_receipt_consumer_v1;SELECT thefa_customer_production_v1.consume_v1('"+p['receipt_id']+"','"+nonce+"','"+p['payload_hash']+"','"+p['binding']['idempotency_key']+"');RESET ROLE;")
b=p['binding']
wid='dcjob-'+hashlib.sha256('|'.join([b['project_key'],b['room_instance'],b['workstream_key'],b['idempotency_key']]).encode()).hexdigest()[:24]
check('stage2-separate-work-unit',wid!=stage1_job)
req=dict(work_unit_id=wid,receipt_id=p['receipt_id'],payload_hash=p['payload_hash'],idempotency_key=b['idempotency_key'],runtime_identity=dict(adapter_instance_id='THEFA_PROVIDER_HOST_4060_V1',adapter_epoch=1),manifest=manifest,core_binding=b)
req['request_binding_hash']=hashj(req)
registered=rpc('ADMIT_WORK_UNIT_V1',fresh(req));check('stage2-admitted',registered['reused'] is False)
prepare=registered['broker_prepare_request']
ctx=rpc('PREPARE_CONTEXT_V1',fresh(prepare));check('stage2-prepare-context',ctx['decision']=='PREPARE_CONTEXT_VERIFIED')
prepared=one("SET ROLE service_role;SELECT public.ceo_core_prepare_guarded_action_v1('"+prepare['context_lease_id']+"','"+b['work_identity_binding_hash']+"','THEFA_PROVIDER_HOST_4060_V1',1,'RISKY_OPERATIONAL_DATA_CHANGE','RED','SUPABASE',"+literal(prepare['intent'])+",'"+b['idempotency_key']+"',"+literal(b['owned_paths'])+",NULL);RESET ROLE;")
aid=prepared['action_id']
auth=rpc('EXECUTE_AUTHORITY_V1',fresh(dict(action_id=aid,prepared_action_hash=prepared['prepared_action_hash'],work_identity_binding_hash=b['work_identity_binding_hash'],runtime_identity=req['runtime_identity'])))
claimed=one("SET ROLE service_role;SELECT public.ceo_core_claim_guarded_action_execution_v1('"+aid+"','sha256:"+'8'*64+"','"+auth['receipt_hash']+"','"+auth['writer_lease_id']+"',1,'"+auth['fresh_source_binding_hash']+"','CUSTOMER_BROKER_RUNTIME_V1');RESET ROLE;")
check('stage2-broker-claimed-once',claimed['decision']=='EXECUTION_CLAIMED')
payload=one("SELECT thefa_customer_broker_v1.provider_payload_v1(a) FROM public.ceo_core_guarded_action_ledger a WHERE action_id='"+aid+"';")
accepted=rpc('PROVIDER_ACCEPT',fresh(payload))
one("SET ROLE service_role;SELECT public.ceo_core_record_guarded_action_provider_result_v1('"+aid+"','"+claimed['attempt_id']+"','ACCEPTED_RECEIPT_PENDING','"+accepted['provider_operation_id']+"','"+accepted['provider_request_hash']+"',NULL);RESET ROLE;")
claim=rpc('WORKER_CLAIM',fresh(dict(action_id=aid)))
check('stage2-single-worker-claim',claim['decision']=='WORKER_CLAIMED' and rpc('WORKER_CLAIM',fresh(dict(action_id=aid)))['decision']=='BLOCKED_WORKER_ALREADY_CLAIMED')
validate=dict(action_id=aid,claim_id=claim['claim_id'])
verified_claim=rpc('WORKER_VALIDATE',fresh(validate))
check('stage2-live-claim-readback',verified_claim['decision']=='WORKER_CLAIM_VERIFIED' and verified_claim['attempt_id']==claimed['attempt_id'] and verified_claim['policy_state']=='CONSUMED' and verified_claim['request_binding_hash']==req['request_binding_hash'])
reject('stage2-claim-recheck-needs-fresh','WORKER_VALIDATE',validate)
reject('stage2-claim-recheck-wrong-id','WORKER_VALIDATE',fresh(dict(action_id=aid,claim_id=str(uuid.uuid4()))))
reject('stage2-claim-recheck-extra-key','WORKER_VALIDATE',fresh(dict(**validate,verified=True)))
query("BEGIN;UPDATE public.ceo_succession_work_lease_v1 SET fencing_generation=2;"+sqlrpc('WORKER_VALIDATE',fresh(validate)),fail=True);check('stage2-claim-recheck-new-fence')
query("BEGIN;UPDATE thefa_native_host_v1.trusted_contexts_v1 SET revoked_at=clock_timestamp();"+sqlrpc('WORKER_VALIDATE',fresh(validate)),fail=True);check('stage2-claim-recheck-revoked-native')
observed=dt.datetime.now(dt.timezone.utc).isoformat()
result=dict(action_id=aid,claim_id=claim['claim_id'],provider_request_hash=claim['provider_request_hash'],provider_operation_id=claim['provider_operation_id'],artifact_hashes=manifest['artifacts'],operation_code_sha256='a'*64,observed_at=observed,readback=dict(project_ref='cgrppxfdurpzzfvkmfte',runtime_role=dict(name='core_customer_auth_runtime',can_login=True,superuser=False,bypass_rls=False,create_db=False,create_role=False,replication=False,password_is_null=False,scram_verifier_present=True),runtime_login=dict(db_role='core_customer_auth_runtime',scram_authenticated=True,tls_verified=True,verified_at=observed),vercel=dict(project_id='prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',target='production',database_secret_encrypted=True,server_readback_verified=True)))
reject('stage2-result-requires-server-fresh-evidence','WORKER_RESULT',result)
bad=fresh(result);bad['_server_fresh_head']='b'*40;reject('stage2-result-rejects-moved-head','WORKER_RESULT',bad)
for name,keys,value in [
 ('wrong-artifact',['operation_code_sha256'],'0'*64),
 ('wrong-claim',['claim_id'],str(uuid.uuid4())),
 ('password-unset',['readback','runtime_role','password_is_null'],True),
 ('missing-scram',['readback','runtime_role','scram_verifier_present'],False),
 ('non-tls',['readback','runtime_login','tls_verified'],False),
 ('wrong-role',['readback','runtime_login','db_role'],'postgres'),
 ('old-login',['readback','runtime_login','verified_at'],'2020-01-01T00:00:00Z'),
 ('future-login',['readback','runtime_login','verified_at'],'2099-01-01T00:00:00Z'),
 ('vercel-unverified',['readback','vercel','server_readback_verified'],False),
 ('wrong-vercel',['readback','vercel','project_id'],'OTHER_PROJECT'),
 ('extra-key',['approved'],True)]:
    bad=copy(result);target=bad
    for key in keys[:-1]:target=target[key]
    target[keys[-1]]=value
    reject('stage2-'+name,'WORKER_RESULT',fresh(bad))
query("BEGIN;UPDATE public.ceo_succession_work_lease_v1 SET fencing_generation=2;"+sqlrpc('WORKER_RESULT',fresh(result)),fail=True);check('stage2-result-rechecks-fence')
query("BEGIN;UPDATE thefa_native_host_v1.trusted_contexts_v1 SET revoked_at=clock_timestamp();"+sqlrpc('WORKER_RESULT',fresh(result)),fail=True);check('stage2-result-rechecks-revocation')
stored=rpc('WORKER_RESULT',fresh(result));check('stage2-result-recorded',stored['decision']=='PROVIDER_RESULT_RECORDED')
reject('stage2-claim-recheck-rejects-completed-effect','WORKER_VALIDATE',fresh(validate))
check('stage2-result-operation-binding',stored['receipt_metadata']['operation']=='CONFIGURE_CUSTOMER_AUTH_ENV' and stored['receipt_metadata']['operation_code_sha256']=='a'*64)
check('stage2-result-canonical-hash',stored['provider_receipt_hash']==hashj({k:v for k,v in stored.items() if k not in ['decision','provider_receipt_hash','result_binding_hash']}))
check('stage2-duplicate-with-new-server-timestamp',rpc('WORKER_RESULT',fresh(result))['decision']=='DUPLICATE_PROVIDER_RESULT_NOOP')
bad=copy(result);bad['observed_at']=dt.datetime.now(dt.timezone.utc).isoformat();reject('stage2-immutable-result','WORKER_RESULT',fresh(bad))
readreq=dict(mode='READBACK_ACTION_V1',action_id=aid,target_provider='SUPABASE',provider_idempotency_key=payload['provider_idempotency_key'],intent_hash=payload['intent_hash'],authority_receipt_hash=payload['authority_receipt_hash'],fencing_generation=1)
rb=rpc('READBACK_ACTION_V1',readreq);check('stage2-provider-readback',rb['status']=='APPLIED_VERIFIED')
dispatch=one("SELECT public.ceo_core_get_guarded_action_dispatch_v1('"+aid+"');")
verified=rpc('VERIFY_PROVIDER_RECEIPT_V1',dict(action=dispatch,authority_reference=dict(receipt_hash=auth['receipt_hash'],fencing_generation=1),provider_result=rb['provider_result']))
check('stage2-independent-receipt-verifier',verified['verified'])
one("SET ROLE service_role;SELECT public.ceo_core_begin_guarded_action_reconciliation_v1('"+aid+"');RESET ROLE;")
final=one("SET ROLE service_role;SELECT public.ceo_core_finalize_guarded_action_v1('"+aid+"','"+claimed['attempt_id']+"','SUPABASE','"+verified['provider_operation_id']+"','"+verified['provider_request_hash']+"','"+verified['provider_receipt_hash']+"','"+verified['result_binding_hash']+"','"+auth['receipt_hash']+"',1,"+literal(verified['receipt_metadata'])+");RESET ROLE;")
check('stage2-existing-broker-terminal',final['decision']=='ACTION_COMPLETED_VERIFIED')
terminal=rpc('GET_PROVIDER_WORK_UNIT_V1',dict(work_unit_id=wid));check('stage2-terminal-readback',terminal['state']=='COMPLETED' and terminal['provider_terminal_verified'])
check('stage1-terminal-preserved',rpc('GET_PROVIDER_WORK_UNIT_V1',dict(work_unit_id=stage1_job))['state']=='COMPLETED')
check('stage2-exact-source-frozen',all(path.read_bytes()==source_bytes[str(path)] for path in sources))
output=dict(result='PASS',stage1_tests=stage1_count,stage2_tests=len(checks)-stage1_count,checks=checks,database=DB,container=CONTAINER,fixture_only=True,native_authentication_proven=False,production_mutations=0,source_sha256={str(Path(p).relative_to(ROOT)):hashlib.sha256(v).hexdigest() for p,v in source_bytes.items()},terminal=terminal)
(ROOT/'tests/customer-broker-stage2-db-results.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
print(json.dumps({k:output[k] for k in ['result','stage1_tests','stage2_tests','database','fixture_only','production_mutations']}))
