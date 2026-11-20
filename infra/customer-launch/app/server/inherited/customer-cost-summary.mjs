import {priceModelUsage} from './customer-model-costs.mjs';
import {priceDeepSeekFlash} from './customer-cost-meter.mjs';
const HEX=/^[a-f0-9]{64}$/;
const code=(name,status)=>Object.assign(Error(name),{code:name,status});
export function summarizeCustomerCostRecords(rows){
 if(!Array.isArray(rows))throw code('P1B_SUMMARY_INVALID',503);
 let total=0,input=0,output=0,gaps=0,failed=0,pending=0;
 const seen=new Set(),days=new Map(),providers=new Map();
 for(const row of rows){
  if(!HEX.test(row?.requestRef??'')||seen.has(row.requestRef))throw code('P1B_SUMMARY_DUPLICATE_OR_INVALID',503);
  seen.add(row.requestRef);
  const day=typeof row.observedAt==='string'?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.observedAt)):null;
  if(!day)throw code('P1B_SUMMARY_DATE_INVALID',503);
  const bucket=days.get(day)??{day,requests:0,estimatedKrwMicros:0,gaps:0};bucket.requests++;
  const provider=providers.get(row.provider)??{provider:row.provider,requests:0,inputTokens:0,outputTokens:0,estimatedKrwMicros:0,gaps:0};provider.requests++;
  if(row.status==='PROVIDER_REPLY_RECEIVED_PENDING_CHAT')pending++;else if(row.answerHash===null)failed++;
  if(row.cost&&row.usage){
   const recomputed=row.version===2?priceModelUsage(row.modelId,row.usage):priceDeepSeekFlash(row.usage);
   if(recomputed&&(recomputed.estimatedKrwMicros!==row.cost.estimatedKrwMicros||recomputed.priceVersion!==row.priceVersion))throw code('P1B_SUMMARY_PRICE_INVALID',503);
   if(!Number.isSafeInteger(row.cost.estimatedKrwMicros)||row.cost.estimatedKrwMicros<0)throw code('P1B_SUMMARY_PRICE_INVALID',503);
   total+=row.cost.estimatedKrwMicros;input+=row.usage.promptTokens;output+=row.usage.completionTokens;
   bucket.estimatedKrwMicros+=row.cost.estimatedKrwMicros;
   provider.estimatedKrwMicros+=row.cost.estimatedKrwMicros;provider.inputTokens+=row.usage.promptTokens;provider.outputTokens+=row.usage.completionTokens;
  }else{gaps++;bucket.gaps++;provider.gaps++;}
  days.set(day,bucket);providers.set(row.provider,provider);
 }
 return {status:gaps?'INCOMPLETE_COST_EVIDENCE_RECONCILIATION_REQUIRED':'ESTIMATE_ONLY_VENDOR_INVOICE_PENDING',
  requests:rows.length,successfulRequests:rows.length-failed-pending,failedRequests:failed,pendingRequests:pending,
  inputTokens:gaps?null:input,outputTokens:gaps?null:output,
  estimatedKrwMicros:gaps?null:total,verifiedSubsetKrwMicros:total,costEvidenceGaps:gaps,
  byDay:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)),byProvider:[...providers.values()],
  vendorInvoiceMatched:false,paymentEntitlementGranted:false};
}
