import {createIsolatedCloudAllowance} from './inherited/cloud-allowance.mjs';
import {createTenantCloudPersistence} from './inherited/customer-tenant-storage.mjs';
import {executeCustomerChatApi} from './inherited/customer-chat-api.mjs';
import {readStageOidcAccountConfig,readStageOidcCustomerAccount} from './oidc-stage-account.mjs';

const paths=new Set(['/api/auth/providers','/api/auth/session','/auth/start',
 '/auth/logout','/auth/complete','/auth/email/send','/auth/email/verify',
 '/api/customer/workspace','/api/customer/action','/api/customer/chat/send',
 '/api/customer/billing','/api/customer/allowance']);
const convo=/^\/api\/customer\/conversations\/chat_[0-9a-f-]{36}$/;
const err=(status,code)=>({status,body:{code}});
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
function send(res,status,body,cookies=[]){
 res.statusCode=status;
 res.setHeader('cache-control','no-store');
 res.setHeader('content-type','application/json; charset=utf-8');
 res.setHeader('x-content-type-options','nosniff');
 res.setHeader('referrer-policy','no-referrer');
 res.setHeader('vary','Cookie');
 if(cookies.length)res.setHeader('set-cookie',cookies);
 res.end(JSON.stringify(body));
}
function readHeaders(req){
 const h=new Headers(req.headers||{});
 const sensitive=new Set(['host','cookie','origin','x-forwarded-host','x-forwarded-proto']);
 if(Array.isArray(req.rawHeaders)){
  const seen=new Set();
  for(let i=0;i<req.rawHeaders.length;i+=2){
   const name=String(req.rawHeaders[i]).toLowerCase();
   if(seen.has(name)&&sensitive.has(name))throw err(400,'DUPLICATE_TRUST_HEADER');
   seen.add(name);
  }
 }
 return h;
}
function validate(req,config){
 if(!['GET','POST'].includes(req.method))throw err(405,'METHOD_NOT_ALLOWED');
 if(typeof req.url!=='string'||req.url.length>8192||!req.url.startsWith('/')||req.url.startsWith('//')||
  /[\r\n#\\]/.test(req.url))throw err(400,'INVALID_REQUEST_URL');
 const origin=process.env.THEFA_CORE_OIDC_ORIGIN;
 const u=new URL(req.url,origin);
 const h=readHeaders(req),host=new URL(origin).host;
 if(u.origin!==origin||u.search||u.hash||u.pathname.includes('%')||
   h.get('host')!==host||
   (h.has('x-forwarded-host')&&h.get('x-forwarded-host')!==host)||
   (h.has('x-forwarded-proto')&&h.get('x-forwarded-proto')!=='https')||
   h.has('x-original-url')||
   (h.has('sec-fetch-site')&&!['same-origin','none'].includes(h.get('sec-fetch-site'))))
  throw err(403,'THEFA_CORE_STAGE_ORIGIN_REQUIRED');
 if(!paths.has(u.pathname)&&!convo.test(u.pathname))throw err(404,'CUSTOMER_ROUTE_NOT_FOUND');
 if(req.method==='POST'&&
   (h.get('origin')!==origin||
    !/^application\/json(?:\s*;|$)/i.test(h.get('content-type')||'')||
    (req.body!==undefined&&req.body!==null)))throw err(403,'THEFA_CORE_STAGE_POST_CSRF');
 if(req.method==='GET'&&h.has('content-length')&&h.get('content-length')!=='0')
  throw err(400,'UNEXPECTED_GET_BODY');
 return {url:u,headers:h};
}
async function body(req,max=12000){
 let size=0;const chunks=[];
 for await(const chunk of req){
  const b=Buffer.from(chunk);size+=b.length;
  if(size>max)throw err(413,'BODY_TOO_LARGE');
  chunks.push(b);
 }
 let obj;
 try{obj=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw err(400,'INVALID_JSON')}
 if(!plain(obj))throw err(400,'JSON_OBJECT_REQUIRED');
 return obj;
}
function providerCatalog(){
 const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
 return {issuer,providers:[{id:'google',enabled:false,callback:issuer+'/callback/google'},
  {id:'kakao',enabled:false,callback:issuer+'/callback/kakao'}],
  email:{enabled:false},unified:{enabled:true,issuer:'https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1'}};
}
async function handle(req,res){
 let c,policy;
 try{c=readStageOidcAccountConfig();policy=validate(req,c);}
 catch(e){const x=e?.body?e:err(503,'THEFA_CORE_STAGE_RUNTIME_NOT_READY');return send(res,x.status,x.body)}
 const route=policy.url.pathname,method=req.method;
 if(route==='/api/auth/providers')return send(res,method==='GET'?200:405,method==='GET'?providerCatalog():{code:'METHOD_NOT_ALLOWED'});
 if(route==='/auth/logout'){
  if(method!=='POST')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
  let v;try{v=await body(req,1024)}catch(e){return send(res,e.status||400,e.body||{code:'INVALID_JSON'})}
  if(Object.keys(v).length!==0)return send(res,400,{code:'LOGOUT_BODY_INVALID'});
  const cookie='__Host-thefa_core_oidc_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
  return send(res,200,{success:true,scope:'CORE_LOCAL_ONLY'},[cookie]);
 }
 if(['/auth/start','/auth/complete','/auth/email/send','/auth/email/verify'].includes(route))
  return send(res,503,{code:'USE_THEFA_UNIFIED_ID_LOGIN'});
 let linked=null;
 try{linked=await readStageOidcCustomerAccount(policy.headers.get('cookie')||'');}
 catch{return send(res,503,{code:'THEFA_CORE_ACCOUNT_READBACK_UNAVAILABLE'})}
 if(route==='/api/auth/session'){
  if(method!=='GET')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
  return send(res,200,{authenticated:!!linked,user:linked?{id:linked.principalId,
   displayName:'THE FA 계정',provider:'oidc'}:null});
 }
 if(!linked)return send(res,401,{code:'AUTH_REQUIRED'});
 const allowance=createIsolatedCloudAllowance({rest:c.rest,secret:c.allowanceKey,usageEpoch:'THEFA_ID_STAGE_20261110_R1'});
 if(route==='/api/customer/allowance'||route==='/api/customer/billing'){
  if(method!=='GET')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
  try{const balance=await allowance.view(linked.principalId);
   return send(res,200,route==='/api/customer/allowance'?{contract:'THEFA_FREE10_ALLOWANCE_STAGE_V1',allowance:balance}:
   {authenticated:true,memberType:'CUSTOMER',allowance:balance,
    subscription:{planId:null,status:'PAYMENT_NOT_CONNECTED'},paymentReady:false,plansUrl:'/plans'});
  }catch{return send(res,503,{code:'THEFA_CORE_ALLOWANCE_UNAVAILABLE'})}
 }
 if(route==='/api/customer/chat/send')return send(res,503,{code:'CUSTOMER_AI_PROVIDER_NOT_CONNECTED'});
 if(method==='POST'&&route!=='/api/customer/action')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
 let requestBody;
 if(method==='POST')try{requestBody=await body(req);}catch(e){return send(res,e.status||400,e.body||{code:'INVALID_JSON'})}
 try{
  const data=await executeCustomerChatApi(route,method,requestBody,{
   email:linked.workspaceEmail,
   env:{CORE_CONSOLE_STORAGE_MODE:'tenant-v3',CORE_CUSTOMER_TENANT_HMAC_KEY:c.tenantKey,
    CORE_CONSOLE_AUDIENCE:'customer-public'},
   persistenceFactory:email=>createTenantCloudPersistence({email,tenantKey:c.tenantKey,rest:c.rest}),
   aiExecutionReady:false});
  if(data.status!==200||route!=='/api/customer/workspace')
   return send(res,data.status,JSON.parse(data.body));
  const view=JSON.parse(data.body);
  const balance=await allowance.view(linked.principalId);
  view.account={authenticated:true,provider:'OIDC_SERVER_VERIFIED',memberType:'CUSTOMER'};
  view.allowance=balance;
  view.subscription={status:'PAYMENT_NOT_CONNECTED'};
  view.capabilities={...view.capabilities,accountRequired:true,chatAiReady:false,localAiCanaryAvailable:false};
  return send(res,200,view);
 }catch{return send(res,503,{code:'THEFA_CORE_STAGE_CUSTOMER_STORAGE_UNAVAILABLE'})}
}
let started;
export default async function oidcStageNode(req,res){
 try{
  started??=Promise.resolve().then(()=>handle);
  return await (await started)(req,res);
 }catch{
  if(res.writableEnded||res.headersSent)return;
  return send(res,503,{code:'THEFA_CORE_STAGE_GATEWAY_UNAVAILABLE'});
 }
}
