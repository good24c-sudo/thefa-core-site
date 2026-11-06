import {timingSafeEqual,createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';

const CORE='https://furfjhymxqsbhvuyeqpx.supabase.co';
const REPO='good24c-sudo/thefa-core-site';
const PREFIXES=['/functions/v1/thefa-customer-broker-authority','/thefa-customer-broker-authority'];
const MODES={
 '/': ['THE_FA_ACTION_BROKER_BEARER',['ADMIT_WORK_UNIT_V1','GET_PROVIDER_WORK_UNIT_V1']],
 '/authority':['THE_FA_ACTION_AUTHORITY_BEARER',['PREPARE_CONTEXT_V1','EXECUTE_AUTHORITY_V1']],
 '/provider':['THE_FA_PROVIDER_INTERNAL_BEARER',['PROVIDER_ACCEPT']],
 '/readback':['THE_FA_PROVIDER_INTERNAL_BEARER',['READBACK_ACTION_V1']],
 '/verify':['THE_FA_PROVIDER_RECEIPT_VERIFIER_BEARER',['VERIFY_PROVIDER_RECEIPT_V1']],
 '/worker':['THE_FA_PROVIDER_INTERNAL_BEARER',['WORKER_CLAIM','WORKER_RESULT','GET_PROVIDER_WORK_UNIT_V1']],
};
const response=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':
 '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const digest=v=>'sha256:'+createHash('sha256').update(canonical(v)).digest('hex');
function authenticated(header,key){
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||typeof header!=='string')return false;
 const expected=Buffer.from('Bearer '+key),given=Buffer.from(header);
 return given.length===expected.length&&timingSafeEqual(given,expected);
}
function forbidden(value){
 if(Array.isArray(value))return value.some(forbidden);
 if(!value||typeof value!=='object')return false;
 return Object.entries(value).some(([k,v])=>k.startsWith('_server_')||
  ['password','secret','access_token','refresh_token','private_key','service_role','authorization','raw_pii'].includes(k.toLowerCase())||forbidden(v));
}
// The network and environment arguments belong to the deployed trusted server,
// never to request JSON. All mutation authorization is independently checked in DB.
export function createCustomerBrokerHandler({env,fetcher=fetch,now=()=>new Date()}){
 async function rpc(mode,payload){
  const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
  if(base!==CORE||!key)throw Error('SERVER_CONFIGURATION_INVALID');
  const res=await fetcher(CORE+'/rest/v1/rpc/ceo_core_customer_broker_v1',{
   method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},
   body:JSON.stringify({p_mode:mode,p_payload:payload}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('CORE_RUNTIME_RPC_REJECTED');
  return res.json();
 }
 async function fresh(payload){
  const lookup=payload.receipt_id?{receipt_id:payload.receipt_id}:payload.action_id?{action_id:payload.action_id}:
   {context_lease_id:payload.context_lease_id};
  const context=await rpc('GET_VALIDATION_CONTEXT_V1',lookup),b=context.core_binding;
  if(!b||b.repository!==REPO||typeof b.branch!=='string'||!b.branch.startsWith('codex/core-customer-launch-')||
   !/^[a-f0-9]{40}$/.test(b.head_sha??''))throw Error('CUSTOMER_SOURCE_BINDING_REQUIRED');
  const url='https://api.github.com/repos/'+REPO+'/git/ref/heads/'+encodeURIComponent(b.branch);
  const r=await fetcher(url,{headers:{accept:'application/vnd.github+json','user-agent':'THEFA-Customer-Broker/1'},
   redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('FRESH_GITHUB_UNAVAILABLE');
  const head=(await r.json())?.object?.sha;
  if(head!==b.head_sha)throw Error('FRESH_GITHUB_HEAD_MISMATCH');
  return {...payload,_server_fresh_head:head,_server_observed_at:now().toISOString()};
 }
 async function brokerPrepare(body){
  if(body?.action!=='prepare_guarded_action')throw Error('SERVER_PREPARE_CONTRACT_REQUIRED');
  const r=await fetcher(CORE+'/functions/v1/thefa-action-broker',{
   method:'POST',headers:{authorization:'Bearer '+env('THE_FA_ACTION_BROKER_BEARER'),'content-type':'application/json'},
   body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('BROKER_PREPARE_OUTCOME_REQUIRES_READBACK');
  const data=await r.json();
  if(!['ACTION_PREPARED','DUPLICATE_NOOP'].includes(data?.decision))throw Error('BROKER_PREPARE_NOT_ACCEPTED');
  return data;
 }
 return async request=>{
  if(request.method!=='POST')return response(405,{error:'POST_REQUIRED'});
  const url=new URL(request.url),prefix=PREFIXES.find(p=>url.pathname===p||url.pathname.startsWith(p+'/'));
  const suffix=prefix?(url.pathname===prefix?'/' : url.pathname.slice(prefix.length)):null;
  const route=prefix?MODES[suffix]:null;
  if(!route)return response(404,{error:'ROUTE_NOT_FOUND'});
  if(!authenticated(request.headers.get('authorization'),env(route[0])))return response(403,{error:'INTERNAL_AUTHENTICATION_REQUIRED'});
  let body;
  try{
   const raw=await request.text();if(Buffer.byteLength(raw,'utf8')>65536)throw Error();
   body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object'||forbidden(body))throw Error();
  }catch{return response(400,{error:'INVALID_BOUNDED_REQUEST'});}
  const mode=suffix==='/provider'?'PROVIDER_ACCEPT':body.mode;
  if(!route[1].includes(mode))return response(403,{error:'MODE_NOT_AUTHORIZED_FOR_CALLER'});
  delete body.mode;
  try{
   if(mode==='ADMIT_WORK_UNIT_V1'){
    const fields=['work_unit_id','receipt_id','payload_hash','idempotency_key','runtime_identity','manifest','core_binding'];
    if(Object.keys(body).sort().join('|')!==[...fields,'request_binding_hash'].sort().join('|')||
     digest(Object.fromEntries(fields.map(k=>[k,body[k]])))!==body.request_binding_hash)
      return response(400,{error:'EXACT_WORK_UNIT_COMMITMENT_REQUIRED'});
    const admitted=await rpc(mode,await fresh(body));
    if(!admitted?.broker_prepare_request)throw Error('SERVER_ADMISSION_NOT_READY');
    // Never create a replacement after a prior durable admission. Observation only.
    if(admitted.reused===true){
     const prior=await rpc('GET_PROVIDER_WORK_UNIT_V1',{work_unit_id:body.work_unit_id});
     return response(200,{...prior,reused:true});
    }
    if(admitted.reused!==false)throw Error('EXPLICIT_NEW_ADMISSION_REQUIRED');
    const prepared=await brokerPrepare(admitted.broker_prepare_request);
    const observed=await rpc('GET_PROVIDER_WORK_UNIT_V1',{work_unit_id:body.work_unit_id});
    if(observed.work_unit_id!==body.work_unit_id||observed.action_id!==prepared.action_id||observed.prepared_action_hash!==prepared.prepared_action_hash||
     observed.request_binding_hash!==body.request_binding_hash)throw Error('ACTION_ADMISSION_READBACK_MISMATCH');
    return response(200,{...observed,decision:'PROVIDER_WORK_UNIT_ADMITTED',reused:prepared.decision==='DUPLICATE_NOOP'});
   }
   const payload=['PREPARE_CONTEXT_V1','EXECUTE_AUTHORITY_V1','WORKER_CLAIM'].includes(mode)?await fresh(body):body;
   return response(200,await rpc(mode,payload));
  }catch(error){
   const code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'RUNTIME_OUTCOME_REQUIRES_READBACK';
   // No upstream response bodies or credential-bearing errors reach callers/logs.
   return response(409,{error:code,retry_allowed:false,reconciliation_required:true});
  }
 };
}
