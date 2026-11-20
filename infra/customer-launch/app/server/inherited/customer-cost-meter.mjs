import {createHash} from 'node:crypto';

/**
 * THE FA Core P1A: read-only, deterministic provider-usage cost evidence.
 * No customer messages, API keys, invoices, payment mutations or database writes.
 * Source rates: DeepSeek official pricing, 2026-11-18 observation.
 * Every displayed amount is an ESTIMATE, not the supplier's settled charge.
 */
export const COST_POLICY = Object.freeze({
  contract:'THEFA_CUSTOMER_AI_COST_P1A_V1',
  rateVersion:'DEEPSEEK_FLASH_V4_20261118_PEAK_MAX',
  model:'deepseek-flash',
  provider:'DEEPSEEK_API',
  estimateFxKrwPerUsd:1600,
  bufferBasisPoints:12500,
  basis:'PEAK_CONSERVATIVE_ONLY',
  currency:'KRW',
  supplierInvoiceMatched:false
});
const PRICE_NANO_USD_PER_TOKEN=Object.freeze({
  peak:Object.freeze({cacheHit:6n,cacheMiss:300n,output:1200n}),
  offPeak:Object.freeze({cacheHit:3n,cacheMiss:150n,output:600n})
});
const HEX64=/^[a-f0-9]{64}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const problem=(code)=>Object.assign(new Error(code),{code});
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const normal=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const ceil=(n,d)=>(n+d-1n)/d;
const krwMicros=nanoUsd=>Number(ceil(nanoUsd*BigInt(COST_POLICY.estimateFxKrwPerUsd),1000n));
const bounded=(n,field)=>{if(!Number.isSafeInteger(n)||n<0||n>1e12)throw problem('COST_AMOUNT_INVALID_'+field);return n;};

export function usageFromDeepSeek(raw) {
  if(!normal(raw)||!int(raw.prompt_tokens,1,48000)||
     !int(raw.completion_tokens,1,2048)||
     !int(raw.total_tokens,2,50000)||
     raw.prompt_tokens+raw.completion_tokens!==raw.total_tokens)
    throw problem('PROVIDER_USAGE_INVALID');
  const hit=raw.prompt_cache_hit_tokens,miss=raw.prompt_cache_miss_tokens;
  const splitPresent=hit!==undefined||miss!==undefined;
  if(splitPresent&&(!int(hit,0,48000)||!int(miss,0,48000)||hit+miss!==raw.prompt_tokens))
    throw problem('PROVIDER_CACHE_ACCOUNTING_INVALID');
  const extra=raw.server_tool_use;
  if(extra!==undefined) {
    if(!normal(extra)||Object.values(extra).some(x=>!int(x,0,100000)))
      throw problem('PROVIDER_TOOL_USAGE_INVALID');
    if(Object.values(extra).some(x=>x>0))
      throw problem('UNPRICED_SERVER_TOOLS_REQUIRE_SEPARATE_RECEIPT');
  }
  return Object.freeze({
    promptTokens:raw.prompt_tokens,
    completionTokens:raw.completion_tokens,
    totalTokens:raw.total_tokens,
    cacheHitTokens:splitPresent?hit:null,
    cacheMissTokens:splitPresent?miss:null,
    cacheStatus:splitPresent?'SUPPLIER_VERIFIED_SPLIT':'UNVERIFIED_ASSUMED_MISS'
  });
}

export function priceDeepSeekFlash(usage) {
  if(!normal(usage)||!int(usage.promptTokens,1,48000)||!int(usage.completionTokens,1,2048)||
     usage.totalTokens!==usage.promptTokens+usage.completionTokens)
    throw problem('COST_USAGE_INVALID');
  const split=usage.cacheStatus==='SUPPLIER_VERIFIED_SPLIT';
  if(split&&(!int(usage.cacheHitTokens,0,48000)||!int(usage.cacheMissTokens,0,48000)||
    usage.cacheHitTokens+usage.cacheMissTokens!==usage.promptTokens))
    throw problem('COST_CACHE_SPLIT_INVALID');
  if(!split&&(usage.cacheStatus!=='UNVERIFIED_ASSUMED_MISS'||
    usage.cacheHitTokens!==null||usage.cacheMissTokens!==null))
    throw problem('COST_CACHE_PROVENANCE_INVALID');
  const inputHit=split?BigInt(usage.cacheHitTokens):0n;
  const inputMiss=split?BigInt(usage.cacheMissTokens):BigInt(usage.promptTokens);
  const output=BigInt(usage.completionTokens);
  const peak=PRICE_NANO_USD_PER_TOKEN.peak;
  const quoted=inputHit*peak.cacheHit+inputMiss*peak.cacheMiss+output*peak.output;
  const upper=BigInt(usage.promptTokens)*peak.cacheMiss+output*peak.output;
  const estimatedKrwMicros=bounded(krwMicros(quoted),'ESTIMATE');
  const conservativeKrwMicros=bounded(
    Number(ceil(BigInt(krwMicros(upper))*BigInt(COST_POLICY.bufferBasisPoints),10000n)),
    'CONSERVATIVE'
  );
  return Object.freeze({
    priceVersion:COST_POLICY.rateVersion,
    priceBasis:COST_POLICY.basis,
    cacheDiscountVerified:split,
    estimatedKrwMicros,
    conservativeKrwMicros,
    estimatedKrwDisplay:Math.ceil(estimatedKrwMicros/1e6),
    conservativeKrwDisplay:Math.ceil(conservativeKrwMicros/1e6),
    quotedNanoUsd:quoted.toString(),
    upperBoundNanoUsd:upper.toString(),
    invoiceReconciled:false,
    actualVendorChargeKrw:null,
    fxIsLive:false
  });
}

export function createUsageReceipt({principalRef,requestRef,observedAt,usage,
  persistedAnswerHash=null,model='deepseek-flash'}={}) {
  if(!HEX64.test(principalRef??'')||!HEX64.test(requestRef??'')||
     (persistedAnswerHash!==null&&!HEX64.test(persistedAnswerHash))||
     model!==COST_POLICY.model||!ISO.test(observedAt??'')||
     !Number.isFinite(Date.parse(observedAt))||
     new Date(observedAt).toISOString()!==observedAt)
    throw problem('RECEIPT_IDENTITY_OR_DATE_INVALID');
  const normalized=usageFromDeepSeek(usage);
  const cost=priceDeepSeekFlash(normalized);
  const identityHash=createHash('sha256').update([
    COST_POLICY.contract,principalRef,requestRef,model,normalized.promptTokens,
    normalized.completionTokens,normalized.cacheHitTokens??'UNKNOWN',
    normalized.cacheMissTokens??'UNKNOWN',observedAt
  ].join('|')).digest('hex');
  return Object.freeze({
    contract:COST_POLICY.contract,
    evidenceId:identityHash,
    principalRef,requestRef,model,provider:COST_POLICY.provider,observedAt,
    answerHash:persistedAnswerHash,
    state:persistedAnswerHash===null?'MODEL_USAGE_OBSERVED_ANSWER_UNVERIFIED':
      'ANSWER_PERSISTED_COST_ESTIMATED_INVOICE_PENDING',
    usage:normalized,cost,
    noPaymentEntitlementGranted:true,
    noModelRetryPermitted:true
  });
}

export function aggregateReceipts(receipts) {
  if(!Array.isArray(receipts)||receipts.length>10000)throw problem('AGGREGATE_INPUT_INVALID');
  if(receipts.length===0)return Object.freeze({contract:'THEFA_CORE_AI_COST_SUMMARY_P1A_V1',
    evidenceStatus:'NO_USAGE_EVIDENCE',requests:null,estimatedKrwMicros:null,
    conservativeKrwMicros:null,unverifiedAnswerCount:null,vendorInvoiceMatched:false});
  const seen=new Set();let estimated=0n,conservative=0n,unverified=0,missingCache=0;
  for(const receipt of receipts){
    if(!normal(receipt)||receipt.contract!==COST_POLICY.contract||
       !HEX64.test(receipt.principalRef??'')||!HEX64.test(receipt.requestRef??'')||
       !HEX64.test(receipt.evidenceId??'')||!normal(receipt.cost)||
       receipt.cost.priceVersion!==COST_POLICY.rateVersion||
       !int(receipt.cost.estimatedKrwMicros,0,1e12)||
       !int(receipt.cost.conservativeKrwMicros,0,1e12)||
       receipt.cost.invoiceReconciled!==false)
      throw problem('AGGREGATE_RECEIPT_INVALID');
    // Recalculate from supplier usage; never trust a caller's currency amount.
    let checked;
    try{checked=priceDeepSeekFlash(receipt.usage);}catch{throw problem('AGGREGATE_RECEIPT_INVALID');}
    const expectedId=createHash('sha256').update([
      COST_POLICY.contract,receipt.principalRef,receipt.requestRef,receipt.model,
      receipt.usage.promptTokens,receipt.usage.completionTokens,
      receipt.usage.cacheHitTokens??'UNKNOWN',receipt.usage.cacheMissTokens??'UNKNOWN',
      receipt.observedAt
    ].join('|')).digest('hex');
    if(receipt.evidenceId!==expectedId||receipt.model!==COST_POLICY.model||
       receipt.provider!==COST_POLICY.provider||!ISO.test(receipt.observedAt??'')||
       new Date(receipt.observedAt).toISOString()!==receipt.observedAt||
       (receipt.answerHash!==null&&!HEX64.test(receipt.answerHash))||
       receipt.state!==(receipt.answerHash===null?'MODEL_USAGE_OBSERVED_ANSWER_UNVERIFIED':
         'ANSWER_PERSISTED_COST_ESTIMATED_INVOICE_PENDING')||
       receipt.cost.estimatedKrwMicros!==checked.estimatedKrwMicros||
       receipt.cost.conservativeKrwMicros!==checked.conservativeKrwMicros||
       receipt.cost.quotedNanoUsd!==checked.quotedNanoUsd||
       receipt.cost.upperBoundNanoUsd!==checked.upperBoundNanoUsd||
       receipt.cost.priceBasis!==COST_POLICY.basis||
       receipt.cost.actualVendorChargeKrw!==null||
       receipt.noPaymentEntitlementGranted!==true||
       receipt.noModelRetryPermitted!==true)
      throw problem('AGGREGATE_RECEIPT_INVALID');
    const key=receipt.principalRef+':'+receipt.requestRef;
    if(seen.has(key))throw problem('DUPLICATE_REQUEST_RECEIPT_NO_DOUBLE_COUNT');
    seen.add(key);
    if(receipt.state!=='ANSWER_PERSISTED_COST_ESTIMATED_INVOICE_PENDING')unverified++;
    if(receipt.usage?.cacheStatus!=='SUPPLIER_VERIFIED_SPLIT')missingCache++;
    estimated+=BigInt(receipt.cost.estimatedKrwMicros);
    conservative+=BigInt(receipt.cost.conservativeKrwMicros);
  }
  return Object.freeze({
    contract:'THEFA_CORE_AI_COST_SUMMARY_P1A_V1',
    evidenceStatus:'SUPPLIER_USAGE_WITH_ESTIMATED_PRICES_NO_INVOICE',
    requests:seen.size,estimatedKrwMicros:bounded(Number(estimated),'AGGREGATE'),
    conservativeKrwMicros:bounded(Number(conservative),'AGGREGATE'),
    unverifiedAnswerCount:unverified,missingCacheBreakdownCount:missingCache,
    vendorInvoiceMatched:false,customerPaymentsObserved:false
  });
}
