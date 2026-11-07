import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerBrokerHandler,digest} from '../runtime/customer-broker-handler.mjs';

// TEST_ONLY server/network adapters. No sockets, database connections or real keys.
const BASE='https://furfjhymxqsbhvuyeqpx.supabase.co';
const URL=BASE+'/functions/v1/thefa-customer-broker-authority';
const HEAD='a'.repeat(40),H='sha256:'+'b'.repeat(64),ACTION='11111111-1111-4111-8111-111111111111';
const envs={SUPABASE_URL:BASE,SUPABASE_SERVICE_ROLE_KEY:'TEST_ONLY_SERVICE_ROLE',
 THE_FA_ACTION_BROKER_BEARER:'1'.repeat(64),THE_FA_ACTION_AUTHORITY_BEARER:'2'.repeat(64),
 THE_FA_PROVIDER_INTERNAL_BEARER:'3'.repeat(64),THE_FA_PROVIDER_RECEIPT_VERIFIER_BEARER:'4'.repeat(64)};
const binding={repository:'good24c-sudo/thefa-core-site',branch:'codex/core-customer-launch-v1-20261029',head_sha:HEAD};
function admission(){
 const p={work_unit_id:'dcjob-'+'a'.repeat(24),receipt_id:ACTION,payload_hash:H,idempotency_key:'TEST_ONLY_OPERATION',
  runtime_identity:{adapter_instance_id:'THEFA_PROVIDER_HOST_4060_V1',adapter_epoch:1},
  manifest:{supabase_project_ref:'cgrppxfdurpzzfvkmfte',artifacts:[]},core_binding:binding};
 return {...p,request_binding_hash:digest(p)};
}
function fixture(options={}){
 const calls=[],payload=admission();
 const observed={decision:'PROVIDER_WORK_UNIT_READBACK',work_unit_id:payload.work_unit_id,action_id:ACTION,
  prepared_action_hash:H,request_binding_hash:payload.request_binding_hash,state:'PREPARED'};
 const fetcher=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,init,body});
  if(url.startsWith('https://api.github.com/')){
   assert.equal(init.redirect,'error');
   return Response.json({object:{sha:options.gitHead??HEAD}},{status:options.gitStatus??200});
  }
  if(url.endsWith('/rest/v1/rpc/ceo_core_customer_broker_v1')){
   assert.equal(init.redirect,'error');
   assert.equal(init.headers.authorization,'Bearer TEST_ONLY_SERVICE_ROLE');
   if(options.rpcThrow)throw Error('TEST_FAILURE_WITH_SECRET=never_return_this');
   const {p_mode:mode,p_payload:request}=body;
   if(mode==='GET_VALIDATION_CONTEXT_V1')return Response.json({core_binding:options.binding??binding,
    manifest:{operations:options.operations??['INSTALL_AUTH_SCHEMA']}});
   if(mode==='ADMIT_WORK_UNIT_V1'){
    assert.equal(request._server_fresh_head,HEAD);
    assert.equal(request._server_observed_at,'2026-11-06T06:00:00.000Z');
    return Response.json({reused:options.reused??false,broker_prepare_request:{action:'prepare_guarded_action',intent:{fixture_only:true}}});
   }
   if(mode==='GET_PROVIDER_WORK_UNIT_V1')return Response.json({...observed,...options.observed});
   return Response.json({decision:'FIXTURE_RPC_ONLY',mode});
  }
  if(url===BASE+'/functions/v1/thefa-action-broker'){
   assert.equal(init.redirect,'error');
   assert.equal(init.headers.authorization,'Bearer '+envs.THE_FA_ACTION_BROKER_BEARER);
   if(options.brokerThrow)throw Error('SIMULATED_TRANSPORT_WITH_SECRET=not_for_output');
   return Response.json({decision:options.prepareDecision??'ACTION_PREPARED',action_id:ACTION,prepared_action_hash:H});
  }
  throw Error('UNEXPECTED_NETWORK_DESTINATION');
 };
 const handler=createCustomerBrokerHandler({env:k=>({...envs,...options.env})[k],fetcher,now:()=>new Date('2026-11-06T06:00:00Z')});
 const send=async(suffix,body,token=envs.THE_FA_ACTION_BROKER_BEARER,method='POST')=>{
  const request=new Request(URL+suffix,{method,headers:token?{authorization:'Bearer '+token}:undefined,
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const response=await handler(request);return {status:response.status,body:await response.json()};
 };
 return {calls,payload,send,handler};
}
test('unauthenticated request never reaches any trusted adapter',async()=>{
 const f=fixture();assert.equal((await f.send('',{mode:'GET_PROVIDER_WORK_UNIT_V1'},null)).status,403);assert.equal(f.calls.length,0);
});
test('HTTP method and unknown route fail before any adapter',async()=>{
 const f=fixture();assert.equal((await f.send('',{},null,'GET')).status,405);
 assert.equal((await f.send('/not-a-route',{})).status,404);assert.equal(f.calls.length,0);
});
test('gateway-stripped path preserves route authentication and exact boundaries',async()=>{
 const f=fixture(),base=BASE+'/thefa-customer-broker-authority';
 for(const [suffix,status] of [['',200],['/worker',403],['-other',404],['/not-a-route',404]]){
  const r=await f.handler(new Request(base+suffix,{method:'POST',headers:{authorization:'Bearer '+envs.THE_FA_ACTION_BROKER_BEARER},body:JSON.stringify({mode:'GET_PROVIDER_WORK_UNIT_V1'})}));
  assert.equal(r.status,status);
 }
 assert.equal(f.calls.length,1);
});
for(const [suffix,mode,correct] of [['','GET_PROVIDER_WORK_UNIT_V1','1'],['/authority','EXECUTE_AUTHORITY_V1','2'],
 ['/provider','PROVIDER_ACCEPT','3'],['/readback','READBACK_ACTION_V1','3'],['/verify','VERIFY_PROVIDER_RECEIPT_V1','4'],['/worker','WORKER_CLAIM','3'],['/worker','WORKER_VALIDATE','3']]){
 test('caller key is scoped to '+suffix+' '+mode,async()=>{
  const f=fixture(),wrong=correct==='1'?'2':'1';
  assert.equal((await f.send(suffix,{mode,action_id:ACTION},wrong.repeat(64))).status,403);assert.equal(f.calls.length,0);
  assert.equal((await f.send(suffix,{mode,action_id:ACTION},correct.repeat(64))).status,200);
  assert.ok(f.calls.some(x=>x.body?.p_mode===mode));
 });
}
test('right key cannot invoke another route mode',async()=>{
 const f=fixture();assert.equal((await f.send('/worker',{mode:'ADMIT_WORK_UNIT_V1'},'3'.repeat(64))).status,403);assert.equal(f.calls.length,0);
});
for(const forbidden of [{_server_fresh_head:HEAD},{nested:{_server_observed_at:'fake'}},{nested:[{private_key:'TEST_ONLY'}]}]){
 test('caller cannot inject trusted server evidence '+JSON.stringify(forbidden),async()=>{
  const f=fixture();assert.equal((await f.send('',{mode:'GET_PROVIDER_WORK_UNIT_V1',...forbidden})).status,400);assert.equal(f.calls.length,0);
 });
}
test('bounded request rejects oversized authenticated JSON',async()=>{
 const f=fixture();assert.equal((await f.send('',{mode:'GET_PROVIDER_WORK_UNIT_V1',data:'x'.repeat(66000)})).status,400);assert.equal(f.calls.length,0);
});
test('changed commitment and unexpected flags cannot reach admission',async()=>{
 const f=fixture();const p={...f.payload,manifest:{supabase_project_ref:'different'}};
 assert.equal((await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...p})).status,400);
 assert.equal((await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload,verified:true})).status,400);assert.equal(f.calls.length,0);
});
test('fresh GitHub mismatch blocks before durable admission',async()=>{
 const f=fixture({gitHead:'c'.repeat(40)}),r=await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload});
 assert.equal(r.status,409);assert.equal(r.body.error,'FRESH_GITHUB_HEAD_MISMATCH');
 assert.equal(f.calls.filter(x=>x.body?.p_mode==='ADMIT_WORK_UNIT_V1').length,0);
});
test('Stage2 result gets Fresh GitHub evidence only from the server',async()=>{
 const f=fixture({operations:['CONFIGURE_CUSTOMER_AUTH_ENV']});
 assert.equal((await f.send('/worker',{mode:'WORKER_RESULT',action_id:ACTION},'3'.repeat(64))).status,200);
 const call=f.calls.find(x=>x.body?.p_mode==='WORKER_RESULT');
 assert.equal(call.body.p_payload._server_fresh_head,HEAD);
 assert.equal(call.body.p_payload._server_observed_at,'2026-11-06T06:00:00.000Z');
});
test('Stage2 result with moved GitHub head never reaches result persistence',async()=>{
 const f=fixture({operations:['CONFIGURE_CUSTOMER_AUTH_ENV'],gitHead:'c'.repeat(40)});
 assert.equal((await f.send('/worker',{mode:'WORKER_RESULT',action_id:ACTION},'3'.repeat(64))).status,409);
 assert.equal(f.calls.some(x=>x.body?.p_mode==='WORKER_RESULT'),false);
});
test('Stage1 result retains its exact original payload',async()=>{
 const f=fixture(),payload={action_id:ACTION,sql_sha256:'a'.repeat(64)};
 assert.equal((await f.send('/worker',{mode:'WORKER_RESULT',...payload},'3'.repeat(64))).status,200);
 assert.deepEqual(f.calls.find(x=>x.body?.p_mode==='WORKER_RESULT').body.p_payload,payload);
 assert.equal(f.calls.some(x=>x.url.startsWith('https://api.github.com/')),false);
});
test('unapproved repository cannot cause an outbound GitHub request',async()=>{
 const f=fixture({binding:{...binding,repository:'unapproved/example'}}),r=await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload});
 assert.equal(r.body.error,'CUSTOMER_SOURCE_BINDING_REQUIRED');assert.equal(f.calls.length,1);
});
test('new admission returns only after exact action and commitment readback',async()=>{
 const f=fixture(),r=await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload});
 assert.equal(r.status,200);assert.equal(r.body.decision,'PROVIDER_WORK_UNIT_ADMITTED');assert.equal(r.body.reused,false);
 assert.equal(r.body.action_id,ACTION);
 assert.deepEqual(f.calls.filter(x=>x.body?.p_mode).map(x=>x.body.p_mode),['GET_VALIDATION_CONTEXT_V1','ADMIT_WORK_UNIT_V1','GET_PROVIDER_WORK_UNIT_V1']);
 assert.equal(f.calls.filter(x=>x.url.endsWith('/thefa-action-broker')).length,1);
});
test('existing durable admission uses observation only',async()=>{
 const f=fixture({reused:true}),r=await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload});
 assert.equal(r.status,200);assert.equal(r.body.reused,true);
 assert.equal(f.calls.filter(x=>x.url.endsWith('/thefa-action-broker')).length,0);
});
test('Broker prepare uncertainty is not retried and error material is sanitized',async()=>{
 const f=fixture({brokerThrow:true}),r=await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload});
 assert.equal(r.status,409);assert.equal(r.body.retry_allowed,false);assert.equal(r.body.reconciliation_required,true);
 assert.equal(f.calls.filter(x=>x.url.endsWith('/thefa-action-broker')).length,1);
 assert.ok(!JSON.stringify(r.body).includes('SECRET'));
});
test('wrong action readback cannot be promoted to accepted',async()=>{
 const f=fixture({observed:{action_id:'22222222-2222-4222-8222-222222222222'}}),r=await f.send('',{mode:'ADMIT_WORK_UNIT_V1',...f.payload});
 assert.equal(r.status,409);assert.equal(r.body.error,'ACTION_ADMISSION_READBACK_MISMATCH');
});
test('wrong Core project configuration blocks credential-bearing requests',async()=>{
 const f=fixture({env:{SUPABASE_URL:'https://unapproved.example'}}),r=await f.send('',{mode:'GET_PROVIDER_WORK_UNIT_V1'});
 assert.equal(r.status,409);assert.equal(r.body.error,'SERVER_CONFIGURATION_INVALID');assert.equal(f.calls.length,0);
});
