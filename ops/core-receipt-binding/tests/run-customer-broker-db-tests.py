"""TEST_ONLY isolated PG16. Existing NativeHost proofs are explicit fixtures.
No service DB connections or real authentication claims. Retains QA DB and logs.
"""
from pathlib import Path
import concurrent.futures
import datetime as dt
import hashlib
import json
import subprocess
import uuid

ROOT=Path(__file__).resolve().parent.parent
PREVIOUS=ROOT
BROKER=ROOT/'tests/fixtures/existing-guarded-action-broker-v1.sql'
CONTAINER='thefa-customer-broker-db-qa-20261106'
DB='customer_broker_qa_'+uuid.uuid4().hex[:10]
CMD=['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d',DB,'-v','ON_ERROR_STOP=1','-At']
checks=[]
def query(sql,fail=False):
    r=subprocess.run(CMD,input=sql.encode() if isinstance(sql,str) else sql,capture_output=True,timeout=30)
    if fail:
        if not r.returncode: raise AssertionError('Expected rejection')
        return r.stderr.decode(errors='replace')
    if r.returncode: raise RuntimeError(r.stderr.decode(errors='replace'))
    return r.stdout.decode()
def one(sql):
    return json.loads(next(x for x in query(sql).splitlines() if x.startswith('{') or x.startswith('[')))
def literal(v): return "'"+json.dumps(v,ensure_ascii=False,separators=(',',':')).replace("'","''")+"'::jsonb"
def fresh(x): return dict(x,_server_fresh_head='a'*40,_server_observed_at=dt.datetime.now(dt.timezone.utc).isoformat())
def sqlrpc(mode,x): return "SET ROLE service_role; SELECT public.ceo_core_customer_broker_v1('"+mode+"',"+literal(x)+");RESET ROLE;"
def rpc(mode,x): return one(sqlrpc(mode,x))
def check(name,truth=True):
    if not truth: raise AssertionError(name)
    checks.append(name)
def reject(name,mode,x): query(sqlrpc(mode,x),fail=True);check(name)
def hashj(v): return 'sha256:'+hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def copy(v): return json.loads(json.dumps(v))

subprocess.run(['docker','exec',CONTAINER,'createdb','-U','postgres',DB],check=True,capture_output=True)
sources=[PREVIOUS/'tests/production-db-fixture.sql',PREVIOUS/'tests/production-current-helper.sql',PREVIOUS/'sql/customer_production_receipt_v1.sql',BROKER,ROOT/'sql/customer_broker_runtime_v1.sql']
source_bytes={str(path):path.read_bytes() for path in sources}
for path in sources: query(source_bytes[str(path)])
# Fixture-only helper for the old Broker's separate sensitive-input primitive.
query("CREATE FUNCTION public.ceo_core_jsonb_has_sensitive_key_v1(x jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT x::text ~ '\"(password|secret|access_token)\"[ ]*:' $$;")
check('installed')
acl=one("SELECT jsonb_build_object('anon',has_function_privilege('anon','public.ceo_core_customer_broker_v1(text,jsonb)','EXECUTE'),'auth',has_function_privilege('authenticated','public.ceo_core_customer_broker_v1(text,jsonb)','EXECUTE'),'service',has_function_privilege('service_role','public.ceo_core_customer_broker_v1(text,jsonb)','EXECUTE'),'table',has_table_privilege('service_role','thefa_customer_broker_v1.work_units_v1','SELECT'));")
check('narrow-rpc-acl',acl==dict(anon=False,auth=False,service=True,table=False))
query("SET ROLE anon;SELECT public.ceo_core_customer_broker_v1('GET_PROVIDER_WORK_UNIT_V1','{}');",fail=True);check('actual-anon-denied')
p=one("SELECT public.test_policy('broker_valid');")
nonce=hashlib.sha256(b'broker_valid').hexdigest()
query("SELECT thefa_customer_production_v1.enroll_policy_v1("+literal(p)+");SET ROLE thefa_core_receipt_issuer_v1;SELECT thefa_customer_production_v1.register_v1('"+p['receipt_id']+"','"+nonce+"');RESET ROLE;SET ROLE thefa_core_receipt_consumer_v1;SELECT thefa_customer_production_v1.consume_v1('"+p['receipt_id']+"','"+nonce+"','"+p['payload_hash']+"','"+p['binding']['idempotency_key']+"');RESET ROLE;")
b=p['binding'];manifest=json.loads(p['manifest_canonical'])
wid='dcjob-'+hashlib.sha256('|'.join([b['project_key'],b['room_instance'],b['workstream_key'],b['idempotency_key']]).encode()).hexdigest()[:24]
req=dict(work_unit_id=wid,receipt_id=p['receipt_id'],payload_hash=p['payload_hash'],idempotency_key=b['idempotency_key'],runtime_identity=dict(adapter_instance_id='THEFA_PROVIDER_HOST_4060_V1',adapter_epoch=1),manifest=manifest,core_binding=b)
req['request_binding_hash']=hashj(req)
bad=copy(req);bad['work_unit_id']='dcjob-'+'0'*24;reject('noncanonical-id','ADMIT_WORK_UNIT_V1',fresh(bad))
bad=copy(req);bad['manifest']['supabase_project_ref']='wrong';reject('target-tamper','ADMIT_WORK_UNIT_V1',fresh(bad))
bad=copy(req);bad['request_binding_hash']='sha256:'+'0'*64;reject('request-hash-tamper','ADMIT_WORK_UNIT_V1',fresh(bad))
bad=fresh(req);bad['_server_fresh_head']='b'*40;reject('fresh-head-mismatch','ADMIT_WORK_UNIT_V1',bad)
bad=fresh(req);bad['_server_observed_at']='2020-01-01T00:00:00Z';reject('stale-fresh-evidence','ADMIT_WORK_UNIT_V1',bad)
registered=rpc('ADMIT_WORK_UNIT_V1',fresh(req));check('registered',registered['decision']=='PROVIDER_WORK_UNIT_REGISTERED' and registered['reused'] is False)
check('same-admit-noop',rpc('ADMIT_WORK_UNIT_V1',fresh(req))['reused'] is True)
pending=rpc('GET_PROVIDER_WORK_UNIT_V1',{'work_unit_id':wid});check('local-registration-not-action',pending['state']=='REGISTERED_ACTION_PENDING' and pending['work_unit_accepted'] is False)
prepare=registered['broker_prepare_request']
query("BEGIN;UPDATE public.ceo_succession_work_lease_v1 SET fencing_generation=2;"+sqlrpc('PREPARE_CONTEXT_V1',fresh(prepare)),fail=True);check('changed-fence-after-admission')
query("BEGIN;UPDATE public.ceo_core_recovery_projection_v1 SET ownership=jsonb_set(ownership,'{write_sealed}','true');"+sqlrpc('PREPARE_CONTEXT_V1',fresh(prepare)),fail=True);check('sealed-writer-after-admission')
query("BEGIN;UPDATE thefa_native_host_v1.trusted_contexts_v1 SET expires_at=clock_timestamp()-interval '1 second';"+sqlrpc('PREPARE_CONTEXT_V1',fresh(prepare)),fail=True);check('expired-native-context-after-admission')
query("BEGIN;UPDATE thefa_native_host_v1.trusted_contexts_v1 SET revoked_at=clock_timestamp();"+sqlrpc('PREPARE_CONTEXT_V1',fresh(prepare)),fail=True);check('revoked-native-context-after-admission')
ctx=rpc('PREPARE_CONTEXT_V1',fresh(prepare));check('prepare-context',ctx['decision']=='PREPARE_CONTEXT_VERIFIED')
bad=copy(prepare);bad['intent']['work_unit_id']='dcjob-'+'0'*24;reject('intent-tamper','PREPARE_CONTEXT_V1',fresh(bad))
context=rpc('GET_VALIDATION_CONTEXT_V1',{'context_lease_id':prepare['context_lease_id']});check('prepare-context-lookup',context['receipt_id']==p['receipt_id'])
prepared=one("SET ROLE service_role;SELECT public.ceo_core_prepare_guarded_action_v1('"+prepare['context_lease_id']+"','"+b['work_identity_binding_hash']+"','THEFA_PROVIDER_HOST_4060_V1',1,'RISKY_OPERATIONAL_DATA_CHANGE','RED','SUPABASE',"+literal(prepare['intent'])+",'"+b['idempotency_key']+"',"+literal(b['owned_paths'])+",NULL);RESET ROLE;")
aid=prepared['action_id'];check('existing-broker-prepare',prepared['decision']=='ACTION_PREPARED')
admitted=rpc('GET_PROVIDER_WORK_UNIT_V1',{'work_unit_id':wid});check('actual-action-admitted',admitted['work_unit_accepted'] and admitted['action_id']==aid)
authreq=dict(action_id=aid,prepared_action_hash=prepared['prepared_action_hash'],work_identity_binding_hash=b['work_identity_binding_hash'],runtime_identity=req['runtime_identity'])
auth=rpc('EXECUTE_AUTHORITY_V1',fresh(authreq));check('authority-derived',auth['representative_approval_verified'] and auth['fencing_generation']==1)
claimed=one("SET ROLE service_role;SELECT public.ceo_core_claim_guarded_action_execution_v1('"+aid+"','sha256:"+'7'*64+"','"+auth['receipt_hash']+"','"+auth['writer_lease_id']+"',1,'"+auth['fresh_source_binding_hash']+"','CUSTOMER_BROKER_RUNTIME_V1');RESET ROLE;")
check('existing-broker-single-claim',claimed['decision']=='EXECUTION_CLAIMED')
reject('second-authority-denied','EXECUTE_AUTHORITY_V1',fresh(authreq))
payload=one("SELECT thefa_customer_broker_v1.provider_payload_v1(a) FROM public.ceo_core_guarded_action_ledger a WHERE action_id='"+aid+"';")
accepted=rpc('PROVIDER_ACCEPT',fresh(payload));check('provider-async-accepted',accepted['kind']=='ACCEPTED_RECEIPT_PENDING')
bad=copy(payload);bad['intent_hash']='sha256:'+'9'*64;reject('provider-payload-tamper','PROVIDER_ACCEPT',fresh(bad))
one("SET ROLE service_role;SELECT public.ceo_core_record_guarded_action_provider_result_v1('"+aid+"','"+claimed['attempt_id']+"','ACCEPTED_RECEIPT_PENDING','"+accepted['provider_operation_id']+"','"+accepted['provider_request_hash']+"',NULL);RESET ROLE;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    claims=list(pool.map(lambda _:rpc('WORKER_CLAIM',fresh({'action_id':aid})),range(2)))
check('concurrent-worker-one-claim',sum(x['decision']=='WORKER_CLAIMED' for x in claims)==1)
claim=next(x for x in claims if x['decision']=='WORKER_CLAIMED')
check('worker-claim-full-binding',claim['request_binding_hash']==req['request_binding_hash'] and claim['authority_receipt_hash']==auth['receipt_hash'] and claim['admission_receipt_hash']==p['receipt_hash'] and claim['fencing_generation']==1)
readreq=dict(mode='READBACK_ACTION_V1',action_id=aid,target_provider='SUPABASE',provider_idempotency_key=payload['provider_idempotency_key'],intent_hash=payload['intent_hash'],authority_receipt_hash=payload['authority_receipt_hash'],fencing_generation=1)
check('missing-effect-remains-unknown',rpc('READBACK_ACTION_V1',readreq)['status']=='UNKNOWN')
tables=['core_customer_auth.account','core_customer_auth.session','core_customer_auth.user','core_customer_auth.verification','public.core_console_artifacts_v3','public.core_console_state_v3']
result=dict(action_id=aid,claim_id=claim['claim_id'],provider_request_hash=claim['provider_request_hash'],provider_operation_id=claim['provider_operation_id'],artifact_hashes=manifest['artifacts'],sql_sha256=claim['sql_sha256'],observed_at=dt.datetime.now(dt.timezone.utc).isoformat(),readback=dict(project_ref='cgrppxfdurpzzfvkmfte',tables=[dict(schema=t.split('.')[0],name=t.split('.')[1],rls_enabled=True,force_rls=True) for t in tables],runtime_role=dict(name='core_customer_auth_runtime',can_login=True,superuser=False,bypass_rls=False,create_db=False,create_role=False,replication=False,password_is_null=True)))
bad=copy(result);bad['sql_sha256']='0'*64;reject('sql-pin-tamper','WORKER_RESULT',bad)
bad=copy(result);bad['readback']['tables'][0]['force_rls']=False;reject('unsafe-catalog','WORKER_RESULT',bad)
bad=copy(result);bad['readback']['runtime_role']['superuser']=True;reject('privileged-runtime-role','WORKER_RESULT',bad)
bad=copy(result);bad['readback']['runtime_role']['password_is_null']=False;reject('unapproved-password','WORKER_RESULT',bad)
bad=copy(result);bad['verified']=True;reject('self-attested-extra-key','WORKER_RESULT',bad)
stored=rpc('WORKER_RESULT',result);check('provider-result-recorded',stored['decision']=='PROVIDER_RESULT_RECORDED')
check('result-claim-admission-binding',stored['claim_id']==claim['claim_id'] and stored['admission_receipt_hash']==p['receipt_hash'])
check('result-replay-noop',rpc('WORKER_RESULT',result)['decision']=='DUPLICATE_PROVIDER_RESULT_NOOP')
bad=copy(result);bad['observed_at']=dt.datetime.now(dt.timezone.utc).isoformat();reject('result-immutable-conflict','WORKER_RESULT',bad)
rb=rpc('READBACK_ACTION_V1',readreq);check('persisted-result-readback',rb['status']=='APPLIED_VERIFIED')
dispatch=one("SELECT public.ceo_core_get_guarded_action_dispatch_v1('"+aid+"');")
verify=dict(action=dispatch,authority_reference=dict(receipt_hash=auth['receipt_hash'],fencing_generation=1),provider_result=rb['provider_result'])
verified=rpc('VERIFY_PROVIDER_RECEIPT_V1',verify);check('independent-receipt-binding',verified['verified'])
bad=copy(verify);bad['provider_result']['provider_receipt_hash']='sha256:'+'0'*64;reject('provider-receipt-tamper','VERIFY_PROVIDER_RECEIPT_V1',bad)
one("SET ROLE service_role;SELECT public.ceo_core_begin_guarded_action_reconciliation_v1('"+aid+"');RESET ROLE;")
final=one("SET ROLE service_role;SELECT public.ceo_core_finalize_guarded_action_v1('"+aid+"','"+claimed['attempt_id']+"','SUPABASE','"+verified['provider_operation_id']+"','"+verified['provider_request_hash']+"','"+verified['provider_receipt_hash']+"','"+verified['result_binding_hash']+"','"+auth['receipt_hash']+"',1,"+literal(verified['receipt_metadata'])+");RESET ROLE;")
check('existing-broker-finalize',final['decision']=='ACTION_COMPLETED_VERIFIED')
terminal=rpc('GET_PROVIDER_WORK_UNIT_V1',{'work_unit_id':wid});check('cross-checked-terminal',terminal['state']=='COMPLETED' and terminal['provider_terminal_verified'] and terminal['development_complete'] is False)
query("DELETE FROM thefa_customer_broker_v1.worker_claims_v1 WHERE action_id='"+aid+"';",fail=True);check('claim-retained')
query("UPDATE thefa_customer_broker_v1.runtime_config_v1 SET sql_sha256=repeat('0',64);",fail=True);check('sql-pin-immutable')
check('exact-source-frozen',all(path.read_bytes()==source_bytes[str(path)] for path in sources))
output=dict(result='PASS',tests=len(checks),checks=checks,database=DB,container=CONTAINER,fixture_only=True,native_authentication_proven=False,production_mutations=0,sql_sha256=hashlib.sha256(source_bytes[str(ROOT/'sql/customer_broker_runtime_v1.sql')]).hexdigest(),terminal=terminal)
(ROOT/'tests/customer-broker-db-results.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
print(json.dumps({k:output[k] for k in ['result','tests','database','fixture_only','production_mutations','sql_sha256']}))
