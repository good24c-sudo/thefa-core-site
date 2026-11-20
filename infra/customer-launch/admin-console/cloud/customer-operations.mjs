import {customerPlanCatalog} from './shared/customer-plans.mjs';
import {publicRateTable,COST_FX_KRW} from './shared/customer-model-costs.mjs';
import {summarizeCustomerCostRecords} from './shared/customer-cost-summary.mjs';

const CONTRACT='THEFA_CORE_CUSTOMER_OPERATIONS_V1';
const MEMBER='THEFA_CORE_CUSTOMER_MEMBERSHIP_V1';
const LEDGER='THEFA_CORE_AI_COST_LEDGER_P1B_V1';
const HASH=/^[a-f0-9]{64}$/;
const issue=code=>Object.assign(Error(code),{status:503});
const PROVIDERS=[
 {id:'DEEPSEEK_API',name:'DeepSeek',modelId:'deepseek-flash',mode:'더파 기본'},
 {id:'OPENAI_API',name:'OpenAI',modelId:'gpt-6-luna',mode:'빠른 실무'},
 {id:'ANTHROPIC_API',name:'Claude',modelId:'claude-haiku-5-5',mode:'글쓰기·분석'},
 {id:'GEMINI_API',name:'Gemini',modelId:'gemini-3-1-flash-lite',mode:'종합 대화'}
];
export function aggregateCustomerOperations(rows,{now=new Date().toISOString()}={}){
 if(!Array.isArray(rows))throw issue('CUSTOMER_OPERATIONS_ROWS_INVALID');
 const members=new Map(),entries=[];let workspaces=0,legacyWorkspaces=0;
 for(const row of rows){
  if(!/^tenant_[a-f0-9]{64}$/.test(row.workspace_id??''))throw issue('CUSTOMER_OPERATIONS_SCOPE_INVALID');
  if(row.chatVersion===1){workspaces++;if(!row.membership)legacyWorkspaces++;}
  const m=row.membership;
  if(m){
   if(m.contract!==MEMBER||m.status!=='ACTIVE'||m.membershipBasis!=='VERIFIED_CORE_CUSTOMER_SESSION'||
      !HASH.test(m.principalRef??'')||!Number.isFinite(Date.parse(m.firstObservedAt))||!Number.isFinite(Date.parse(m.lastSeenAt)))
     throw issue('CUSTOMER_MEMBERSHIP_EVIDENCE_INVALID');
   const old=members.get(m.principalRef);
   members.set(m.principalRef,{firstObservedAt:old&&old.firstObservedAt<m.firstObservedAt?old.firstObservedAt:m.firstObservedAt,
    lastSeenAt:old&&old.lastSeenAt>m.lastSeenAt?old.lastSeenAt:m.lastSeenAt});
  }
  const l=row.ledger;
  if(l){
   if(l.contract!==LEDGER||l.version!==1||!l.entries||typeof l.entries!=='object'||Array.isArray(l.entries))throw issue('CUSTOMER_COST_LEDGER_INVALID');
   for(const [key,entry] of Object.entries(l.entries)){
    if(key!==entry.requestRef||!HASH.test(entry.principalRef??'')||
      (m&&entry.principalRef!==m.principalRef)||![1,2].includes(entry.version)||
      ![null,false].includes(entry.actualVendorChargeKrw)||entry.customerCreditCharged!==false||entry.paymentEntitlementGranted!==false)
      throw issue('CUSTOMER_COST_SCOPE_INVALID');
    entries.push(entry);
   }
  }
 }
 const cost=summarizeCustomerCostRecords(entries),time=Date.parse(now),all=[...members.values()];
 return {contract:CONTRACT,observedAt:now,coverage:'COMPLETE_CURRENT_PRODUCT_MARKERS',
  membership:{confirmedMembers:members.size,activeLast30Days:all.filter(m=>Date.parse(m.lastSeenAt)>=time-30*86400000).length,
   firstObservedLast30Days:all.filter(m=>Date.parse(m.firstObservedAt)>=time-30*86400000).length,
   customerWorkspaces:workspaces,legacyWorkspacesWithoutMarker:legacyWorkspaces,
   historicalTotalSignups:null,basis:'VERIFIED_CORE_SESSIONS_SINCE_MEMBERSHIP_TRACKING'},
  cost,providers:PROVIDERS.map(p=>({...p,observedRequests:cost.byProvider.find(x=>x.provider===p.id)?.requests??0,
   status:cost.byProvider.some(x=>x.provider===p.id)?'USAGE_OBSERVED':'AWAITING_USAGE_EVIDENCE'})),
  pricing:customerPlanCatalog(),modelPrices:publicRateTable(),
  finance:{revenueKrw:null,mrrKrw:null,paidMembers:null,actualSupplierChargeKrw:null,paymentConnected:false,
   estimatorDefaults:{fxKrwPerUsd:COST_FX_KRW,pgRatePercent:3.4,pgFeeVatPercent:10,targetContributionMarginPercent:40},
   estimatesOnly:true},supportEmail:'thefa@thefa.kr'};
}

/** Fixed GET-only projection. Never fetch auth.users, emails, prompts, keys or session tokens. */
export function createCustomerOperationsReader({url,key,fetchImpl=globalThis.fetch}={}){
 const expected='https://cgrppxfdurpzzfvkmfte.supabase.co';
 return async()=>{
  if(url!==expected||typeof key!=='string'||key.length<20)throw issue('CUSTOMER_OPERATIONS_CONNECTION_UNVERIFIED');
  const rows=[];let cursor=null;
  for(let page=0;page<50;page++){
   const query=new URLSearchParams({select:'workspace_id,membership:state->customerMembership,ledger:state->customerAiCostLedger,chatVersion:state->customerChat->version',
    order:'workspace_id.asc',limit:'200',or:'(state->customerMembership.not.is.null,state->customerAiCostLedger.not.is.null,state->customerChat.not.is.null)',
    workspace_id:cursor?'gt.'+cursor:'like.tenant_*'});
   const result=await fetchImpl(expected+'/rest/v1/core_console_state_v3?'+query,{method:'GET',
    headers:{apikey:key,authorization:'Bearer '+key,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
   if(!result.ok)throw issue('CUSTOMER_OPERATIONS_READ_FAILED');
   const raw=await result.text();if(Buffer.byteLength(raw)>8*1024*1024)throw issue('CUSTOMER_OPERATIONS_PAGE_TOO_LARGE');
   const batch=JSON.parse(raw);if(!Array.isArray(batch)||batch.length>200)throw issue('CUSTOMER_OPERATIONS_PAGE_INVALID');
   for(const item of batch){if(cursor&&item.workspace_id<=cursor)throw issue('CUSTOMER_OPERATIONS_PAGINATION_INVALID');cursor=item.workspace_id;rows.push(item);}
   if(batch.length<200)return aggregateCustomerOperations(rows);
  }
  throw issue('CUSTOMER_OPERATIONS_COVERAGE_INCOMPLETE');
 };
}
