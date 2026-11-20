/**
 * P02 R31: release candidate for server-verified customer REST + saved AI chat.
 *
 * This is a pure handler, NOT mounted to Vercel/Production.
 * No browser-supplied account IDs. Only a trusted BetterAuth session verifier
 * supplies principalId, workspaceEmail, and migration provenance.
 */
import {createTenantCloudPersistence} from './customer-tenant-storage.mjs';
import {executeCustomerChatApi} from './customer-chat-api.mjs';
import {reserveCustomerChatTurn,commitCustomerChatTurn,pauseCustomerChatTurn} from './customer-chat-turn.mjs';
import {conversationDetail} from './customer-chat-domain.mjs';
import {createProtectedFree10AiPipeline} from './free10-budget-admission.mjs';
import {validateCustomerOrigin} from './customer-origin-policy.mjs';
import {isEmployeeEntitlement,employeeAllowanceView} from '../employee-entitlement.mjs';
import {createBoundCreditBilling,customerCreditView} from './customer-credit-wallet.mjs';
import {customerPlanCatalog} from '../customer-plans.mjs';
import {createBoundP1BCostWriter,preflightBoundTenantCostCapacity,recordProviderOutcome,summarizeBoundTenantCost} from './customer-ai-cost-ledger.mjs';
import {touchCustomerMembership,membershipNeedsTouch} from './customer-membership.mjs';

const HASH=/^[0-9a-f]{64}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID=/^[A-Za-z0-9._:-]{8,128}$/;
const CONVERSATION=/^chat_[0-9a-f-]{36}$/;
const PATHS=new Set(['/api/customer/workspace','/api/customer/action',
 '/api/customer/chat/send','/api/customer/billing','/api/customer/allowance','/api/customer/ai-modes','/api/customer/usage',
]);
const reject=(status,code)=>response(status,{code});
// Only send customer conversational fields. Keep full provider evidence server-side.
const publicMessage=m=>{
 if(!m||typeof m!=='object'||Array.isArray(m))return m;
 const {model,modelId,provider,promptTokens,outputTokens,normalizedUsage,supplierUsage,...customerFields}=m;
 return customerFields;
};
const response=(status,body)=>Object.freeze({
 status,headers:Object.freeze({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-robots-tag':'noindex,nofollow',
  'vary':'Cookie'
 }),body:JSON.stringify(body)
});
const normalObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function validRequest({url,method,headers,body}={},origin,host){
 let u;
 try{u=new URL(url);}catch{return {code:'INVALID_REQUEST_URL',status:400}}
 if(u.origin!==origin||u.username||u.password||u.hash||u.search||
  u.pathname.includes('..')||u.pathname.includes('%')||
  (!PATHS.has(u.pathname)&&!/^\/api\/customer\/conversations\/chat_[0-9a-f-]{36}$/.test(u.pathname)))
  return {code:'CUSTOMER_ROUTE_NOT_FOUND',status:404};
 if(!['GET','POST'].includes(method))return {code:'METHOD_NOT_ALLOWED',status:405};
 if(method==='POST'&&!['/api/customer/action','/api/customer/chat/send'].includes(u.pathname))
  return {code:'METHOD_NOT_ALLOWED',status:405};
 if(method==='GET'&&['/api/customer/action','/api/customer/chat/send'].includes(u.pathname))
  return {code:'METHOD_NOT_ALLOWED',status:405};
 const h=new Headers(headers??{});
 if(h.get('host')!==host||
   (h.has('x-forwarded-host')&&h.get('x-forwarded-host')!==host)||
   (h.has('x-forwarded-proto')&&h.get('x-forwarded-proto')!=='https')||
   h.has('x-original-url')||
   (h.has('sec-fetch-site')&&!['same-origin','none'].includes(h.get('sec-fetch-site'))))
  return {code:'CUSTOMER_REQUEST_ORIGIN_INVALID',status:403};
 if(method==='POST'&&(h.get('origin')!==origin||
   !/^application\/json(?:\s*;|$)/i.test(h.get('content-type')??'')||
   !normalObject(body)||Buffer.byteLength(JSON.stringify(body),'utf8')>12000))
  return {code:'CUSTOMER_POST_POLICY_INVALID',status:403};
 if(method==='GET'&&body!==undefined)return {code:'GET_BODY_NOT_ALLOWED',status:400};
 return {url:u,headers:h,code:null};
}
function normalizedPrincipal(p){
 if(!normalObject(p)||p.sessionVerified!==true||!HASH.test(p.principalId??'')||
  typeof p.workspaceEmail!=='string'||p.workspaceEmail.length>254||
  p.workspaceEmail!==p.workspaceEmail.toLowerCase().trim()||
  !EMAIL.test(p.workspaceEmail)||
  !['google','kakao','email'].includes(p.provider)||
  !['NEW_ACCOUNT_CONFIRMED','LEGACY_R9_EXACTLY_RECONCILED','LAUNCH_ACCOUNT_CONFIRMED'].includes(p.accountProvenance))
  return null;
 return Object.freeze({
  principalId:p.principalId,workspaceEmail:p.workspaceEmail,
  accountProvenance:p.accountProvenance,sessionVerified:true,provider:p.provider
 });
}
function verifiedBalance(v){
 return v&&v.freeLimit===10&&Number.isSafeInteger(v.used)&&Number.isSafeInteger(v.pending)&&
  Number.isSafeInteger(v.remaining)&&v.used>=0&&v.pending>=0&&v.remaining>=0&&
  v.used+v.pending+v.remaining===10&&v.planRequired===(v.used===10);
}
function sendPayload(body){
 return normalObject(body)&&[3,4].includes(Object.keys(body).length)&&
  Object.keys(body).every(k=>['conversationId','content','requestId','aiMode'].includes(k))&&
  (body.aiMode===undefined||typeof body.aiMode==='string')&&
  CONVERSATION.test(body.conversationId??'')&&ID.test(body.requestId??'')&&
  typeof body.content==='string'&&body.content.trim().length>=1&&
  body.content.trim().length<=4000;
}
const errorsForUser=new Map([
 ['PAID_CREDITS_INSUFFICIENT',[402,'CREDITS_REQUIRED']],
 ['CREDIT_REQUEST_ALREADY_EXISTS_NO_REPLAY',[409,'CHAT_REQUEST_RECONCILIATION_REQUIRED']],
 ['FREE10_EXHAUSTED_UPGRADE_REQUIRED',[402,'PLAN_REQUIRED']],
 ['TODAY_AI_BUDGET_EXHAUSTED',[429,'TODAY_AI_BUDGET_EXHAUSTED']],
 ['FREE10_REQUEST_ALREADY_RESERVED',[409,'CHAT_REQUEST_RECONCILIATION_REQUIRED']],
 ['BUDGET_REQUEST_ALREADY_EXISTS_NO_REPLAY',[409,'CHAT_REQUEST_RECONCILIATION_REQUIRED']],
 ['CHAT_REQUEST_REQUIRES_RECONCILIATION',[409,'CHAT_REQUEST_RECONCILIATION_REQUIRED']],
 ['AI_DISPATCH_OUTCOME_UNKNOWN_NO_AUTOREPLAY',[503,'CHAT_MODEL_STATE_RECONCILIATION_REQUIRED']],
 ['CHAT_WRITE_OUTCOME_UNCERTAIN_NO_AUTOREPLAY',[503,'CHAT_MODEL_STATE_RECONCILIATION_REQUIRED']],
 ['P1B_LEDGER_FULL_ARCHIVE_REQUIRED',[429,'USAGE_LEDGER_CAPACITY_REACHED']]
]);

export function createVerifiedCustomerApi({
 sessionVerifier,rest,tenantKey,allowance,budget,provider,legacyMigrationVerifier=null,resolveEmployeeEntitlement=null,aiModes=null,membershipTracking=false,pricingPolicyService=null,
}={},originConfig={}){
 const origin=validateCustomerOrigin(originConfig);
 const host=new URL(origin).host;
 if((resolveEmployeeEntitlement!==null&&typeof resolveEmployeeEntitlement!=='function')||typeof sessionVerifier!=='function'||!rest||
  typeof rest.request!=='function'||typeof rest.rpc!=='function'||
  typeof tenantKey!=='string'||tenantKey.length<32||
  typeof allowance?.view!=='function'||typeof allowance?.reserve!=='function'||
  typeof allowance?.settle!=='function'||typeof allowance?.recordCompletion!=='function'||
  typeof budget?.reserve!=='function'||typeof budget?.settle!=='function'||
  typeof budget?.status!=='function'||typeof budget?.cancelWithoutDispatch!=='function'||
  provider?.mode!=='DEEPSEEK_CUSTOMER_CHAT'||provider.model!=='deepseek-flash'||
  provider.maxOutputTokens!==1024||
  typeof provider.ask!=='function')
  throw new Error('VERIFIED_CUSTOMER_RUNTIME_DEPENDENCIES_REQUIRED');

 const storage=email=>createTenantCloudPersistence({email,tenantKey,rest});
 async function creditsFor(session){const store=storage(session.workspaceEmail).store;try{await store.init();return customerCreditView(store.state,session.principalId);}finally{await store.close();}}
 const env=Object.freeze({
  CORE_CONSOLE_STORAGE_MODE:'tenant-v3',
  CORE_CUSTOMER_TENANT_HMAC_KEY:tenantKey,
  CORE_CONSOLE_AUDIENCE:'customer-public',
  CORE_CUSTOMER_DEEPSEEK_ENABLED:'true'
 });

 async function send(session,body){
  if(!sendPayload(body))return reject(400,'CUSTOMER_CHAT_SEND_BODY_INVALID');
  let store=null,reservation=null,modelInvoked=false,billingResult=null;
  let selectedProvider=provider;
  try{if(aiModes)selectedProvider=aiModes.providerFor(body.aiMode??'balanced');
   else if(body.aiMode&&body.aiMode!=='balanced')return reject(503,'CUSTOMER_AI_MODE_UNAVAILABLE');
  }catch(e){return reject(e.status===400?400:503,e.code??'CUSTOMER_AI_MODE_UNAVAILABLE');}
  try{
   const st=storage(session.workspaceEmail);
   store=st.store;
   await store.init();
   if(aiModes)preflightBoundTenantCostCapacity({store,session,tenantKey});
   const pricingSnapshot=pricingPolicyService?(await pricingPolicyService.read()).policy:null;
   reservation=await store.mutate(s=>{const reserved=reserveCustomerChatTurn(s,body);if(!reserved.reused&&pricingSnapshot)s.customerChat.turnRequests[body.requestId].pricingPolicy=structuredClone(pricingSnapshot);return reserved;});
   if(reservation.reused)return reject(409,'CHAT_REQUEST_RECONCILIATION_REQUIRED');
   if(!reservation.messages||!reservation.userMessageId)
    return reject(503,'CHAT_REQUEST_UNVERIFIED');
   const creditBilling=aiModes&&pricingSnapshot?createBoundCreditBilling({store,session,tenantKey,policy:pricingSnapshot}):null;
   const pipeline=createProtectedFree10AiPipeline({
    allowance,budget,creditBilling,provider: {
     mode:selectedProvider.mode,model:selectedProvider.model,modelId:selectedProvider.modelId,
     ask:async({messages,permit})=>{modelInvoked=true;return selectedProvider.ask({messages,permit})}
    },
    persistProviderOutcome:aiModes?async({requestId,modelId,meteringReceipt,outcome})=>store.mutate(state=>recordProviderOutcome(state,{principalId:session.principalId,requestId,modelId,meteringReceipt,outcome,observedAt:new Date().toISOString()})):null,
    persistAnswer:async({requestId,answer})=>{
     if(requestId!==body.requestId)
      throw new Error('CHAT_PERSIST_REQUEST_BINDING_MISMATCH');
     const result=aiModes?await createBoundP1BCostWriter({store,session,tenantKey,settleBilling:creditBilling?.settleInDraft}).commit({requestId,userMessageId:reservation.userMessageId,result:answer}):await store.mutate(state=>commitCustomerChatTurn(state,{
      requestId,userMessageId:reservation.userMessageId,result:answer
     }));
     billingResult=result?.billing??null;
     return {durable:result?.assistantMessage?.role==='assistant'&&
      result?.assistantMessage?.contentSha256===answer.sha256};
    }
   });
   const done=await pipeline.execute({
    principalId:session.principalId,
    requestId:body.requestId,
    messages:reservation.messages,
    sessionVerified:true,
    accountProvenance:session.accountProvenance,employeeEntitlement:session.employeeEntitlement
   });
   if(done.status!=='SAVED_REAL_AI_RESPONSE')
    return reject(503,'CHAT_SUCCESS_RECEIPT_MISSING');
   const conversation=conversationDetail(store.state,body.conversationId);
   const userMessage=conversation.messages.find(m=>m.id===reservation.userMessageId);
   const assistantMessage=conversation.messages.find(m=>m.role==='assistant'&&
    m.contentSha256&&m.id!==reservation.userMessageId&&
    m.state==='MODEL_RESPONSE_RECEIVED_UNVERIFIED'&&
    m.id===store.state.customerChat.turnRequests[body.requestId].assistantMessageId);
   if(!userMessage||!assistantMessage)return reject(503,'CHAT_DURABLE_READBACK_REQUIRED');
   return response(200,{
    reused:false,userMessage:publicMessage(userMessage),assistantMessage:publicMessage(assistantMessage),
    verifiedCoreReceipt:false,...(billingResult?{billing:billingResult}:{})
   });
  }catch(error){
   // Never resend. A model call or persistence write could have succeeded without ACK.
   if(store&&reservation&&!reservation.reused&&!['CHAT_WRITE_OUTCOME_UNCERTAIN_NO_AUTOREPLAY','AI_OUTCOME_PERSISTENCE_UNCERTAIN_NO_AUTOREPLAY','FREE10_SETTLEMENT_RECONCILIATION_REQUIRED','AI_BUDGET_SETTLEMENT_RECONCILIATION_REQUIRED'].includes(error?.code)){
    try{
     const state=store.state.customerChat?.turnRequests?.[body.requestId];
     if(state?.phase==='MODEL_REQUEST_PENDING')
      await store.mutate(s=>pauseCustomerChatTurn(s,{
       requestId:body.requestId,userMessageId:reservation.userMessageId
      }));
    }catch{return reject(503,'CHAT_RECOVERY_REQUIRED')}
   }
   const [status,code]=errorsForUser.get(error?.code)??[503,
    modelInvoked?'CHAT_MODEL_STATE_RECONCILIATION_REQUIRED':'CUSTOMER_CHAT_ADMISSION_UNAVAILABLE'];
   return reject(status,code);
  }finally{
   try{await store?.close();}catch{}
  }
 }

 return async function handle(request){
  const policy=validRequest(request,origin,host);
  if(policy.code)return reject(policy.status,policy.code);
  const cookie=policy.headers.get('cookie');
  if(!cookie||cookie.length<12||cookie.length>8192)return reject(401,'AUTH_REQUIRED');
  let session;
  try{session=normalizedPrincipal(await sessionVerifier(cookie))}
  catch{return reject(503,'CUSTOMER_SESSION_UNAVAILABLE')}
  if(!session)return reject(401,'AUTH_REQUIRED');
  if(session.accountProvenance==='LEGACY_R9_EXACTLY_RECONCILED'){
   // Never create a fresh 10-free ledger for preexisting R9 users with unknown usage.
   // Only an independently verified exact source backup + target ledger receipt can unlock.
   if(typeof legacyMigrationVerifier!=='function')
    return reject(503,'LEGACY_ALLOWANCE_MIGRATION_NOT_VERIFIED');
   let proof;
   try{proof=await legacyMigrationVerifier(session.principalId)}
   catch{return reject(503,'LEGACY_ALLOWANCE_MIGRATION_NOT_VERIFIED')}
   if(!normalObject(proof)||proof.accountId!==session.principalId||
    proof.exactBackupAndTargetVerified!==true||
    proof.targetLedgerExists!==true||
    !HASH.test(proof.receiptSha256??'')||
    !HASH.test(proof.sourceLedgerSha256??'')||
    proof.sourceLedgerSha256!==proof.targetLedgerSha256)
    return reject(503,'LEGACY_ALLOWANCE_MIGRATION_NOT_VERIFIED');
  }

  let employeeEntitlement=null;
  try{
   if(resolveEmployeeEntitlement)employeeEntitlement=await resolveEmployeeEntitlement(cookie,session);
   isEmployeeEntitlement(employeeEntitlement,session.principalId);
  }catch{return reject(503,'EMPLOYEE_VERIFICATION_UNAVAILABLE')}
  session=Object.freeze({...session,employeeEntitlement});
  const employeeUnlimited=employeeEntitlement!==null;
  const balanceForSession=()=>employeeUnlimited?Promise.resolve(employeeAllowanceView(employeeEntitlement,session.principalId)):allowance.view(session.principalId);
  const {pathname}=policy.url;
  if(pathname==='/api/customer/chat/send')return send(session,request.body);
  if(pathname==='/api/customer/ai-modes')return response(200,{contract:'THEFA_CUSTOMER_AI_MODES_V1',modes:aiModes?.list()??[],sharedFreeLimit:10,automaticFallback:false});
  if(pathname==='/api/customer/usage'||(pathname==='/api/customer/workspace'&&membershipTracking)){
   let accountStore;
   try{accountStore=storage(session.workspaceEmail).store;await accountStore.init();
    if(membershipTracking&&membershipNeedsTouch(accountStore.state))await accountStore.mutate(state=>touchCustomerMembership(state,{session}));
    if(pathname==='/api/customer/usage'){
     const cost=summarizeBoundTenantCost({store:accountStore,session,tenantKey});
     return response(200,{contract:'THEFA_CUSTOMER_USAGE_V1',requests:cost.requests??null,costStatus:cost.status,
      estimatedModelCostKrw:cost.estimatedKrwMicros==null?null:cost.estimatedKrwMicros/1e6,invoiceReconciled:false});
    }
   }catch{return reject(503,'CUSTOMER_MEMBERSHIP_OR_USAGE_UNAVAILABLE');}
   finally{try{await accountStore?.close();}catch{}}
  }
  if(pathname==='/api/customer/billing'||pathname==='/api/customer/allowance'||
    pathname==='/api/customer/workspace'){
   let balance,daily,creditBalance,pricingSnapshot;
   try{[balance,daily,creditBalance,pricingSnapshot]=await Promise.all([
    balanceForSession(),budget.status(),creditsFor(session),pricingPolicyService?pricingPolicyService.read():null
   ])}catch{return reject(503,'CUSTOMER_ACCOUNT_LEDGER_UNAVAILABLE')}
   if((!employeeUnlimited&&!verifiedBalance(balance))||daily?.capKrw!==10000||!Number.isSafeInteger(daily.remainingKrw))
    return reject(503,'CUSTOMER_ACCOUNT_LEDGER_INVALID');
   if(pathname==='/api/customer/allowance')
    return response(200,{contract:employeeUnlimited?'THEFA_EMPLOYEE_UNLIMITED_V1':'THEFA_FREE10_ALLOWANCE_R31',allowance:balance,credits:creditBalance});
   if(pathname==='/api/customer/billing')
    return response(200,{
     authenticated:true,memberType:employeeUnlimited?'EMPLOYEE':'CUSTOMER',allowance:balance,
     subscription:{planId:null,status:'PAYMENT_NOT_CONNECTED'},
     paymentReady:false,plansUrl:'/plans',credits:creditBalance,catalog:customerPlanCatalog(pricingSnapshot?.policy)
    });
  }
  // Routing and model selection are managed by THE FA Core, not browser settings.
  if(pathname==='/api/customer/action'&&request.body?.action==='settings.update')
    return reject(403,'CORE_ROUTING_MANAGED_BY_SERVICE');
  try{
   const data=await executeCustomerChatApi(pathname,request.method,request.body,{
    email:session.workspaceEmail,env,
    persistenceFactory:(email)=>storage(email),
    aiExecutionReady:true,provider
   });
   // Existing customer-chat-api handles project/conversation and settings metadata.
   if(pathname==='/api/customer/workspace'&&data.status===200){
    const view=JSON.parse(data.body);
    view.capabilities.accountRequired=true;
    view.capabilities.chatAiReady=true;
    view.capabilities.localAiCanaryAvailable=false;
    view.capabilities.aiModes=aiModes?.list()??[];
    view.capabilities.sharedFreeAllowance=true;
    delete view.capabilities.modelProvider;
    delete view.capabilities.modelName;
    view.account={authenticated:true,provider:'SERVER_VERIFIED',memberType:employeeUnlimited?'EMPLOYEE':'CUSTOMER'};
    view.allowance=await balanceForSession();
    view.credits=await creditsFor(session);
    view.subscription={status:'PAYMENT_NOT_CONNECTED'};
    return response(200,view);
   }
   const safe=JSON.parse(data.body);
   if(pathname.startsWith('/api/customer/conversations/chat_')&&data.status===200&&
     Array.isArray(safe.conversation?.messages)){
     safe.conversation.messages=safe.conversation.messages.map(publicMessage);
   }
   return response(data.status,safe);
  }catch{
   return reject(503,'CUSTOMER_WORKSPACE_UNAVAILABLE');
  }
 };
}

