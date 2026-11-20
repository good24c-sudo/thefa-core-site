/** Versioned standard text API estimates. Usage is observed; invoices are not. */
export const MODEL_COST_VERSION='THEFA_TEXT_API_20261120_V1';
export const COST_FX_KRW=1600;
export const COST_BUFFER_BPS=12500;
const rate=(id,provider,input,read,short,long,output)=>Object.freeze({id,provider,input,read,short,long,output});
// Integers are nano-USD per token, equivalent to USD/1M multiplied by 1000.
export const MODEL_RATES=Object.freeze({
 'deepseek-flash':rate('deepseek-flash','DEEPSEEK_API',300,6,0,0,1200),
 'gpt-6-luna':rate('gpt-6-luna','OPENAI_API',100,10,125,250,500),
 'claude-haiku-5-5':rate('claude-haiku-5-5','ANTHROPIC_API',100,10,125,200,500),
 'gemini-3-1-flash-lite':rate('gemini-3-1-flash-lite','GEMINI_API',250,25,0,0,1500)
});
const fail=code=>Object.assign(new Error(code),{code,status:503});
const integer=(n,max=50000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const ceil=(n,d)=>(n+d-1n)/d;
export function modelRate(id){const r=Object.hasOwn(MODEL_RATES,id)?MODEL_RATES[id]:null;if(!r)throw fail('MODEL_PRICE_NOT_VERIFIED');return r;}
export function normalizeSupplierUsage(modelId,raw,context={}){
 const r=modelRate(modelId);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('MODEL_USAGE_MISSING');
 if(raw.server_tool_use&&Object.values(raw.server_tool_use).some(n=>n!==0))throw fail('MODEL_TOOL_USAGE_UNPRICED');
 if(r.provider==='ANTHROPIC_API'&&((raw.service_tier!==undefined&&!['standard','default'].includes(raw.service_tier))||(raw.inference_geo!==undefined&&raw.inference_geo!=='global')))throw fail('MODEL_SERVICE_TIER_UNPRICED');
 if(r.provider==='GEMINI_API'&&raw.serviceTier!==undefined&&!['standard','unspecified'].includes(raw.serviceTier))throw fail('MODEL_SERVICE_TIER_UNPRICED');
 let totalInput,uncached,read=0,writeShort=0,writeLong=0,output,thinking=0,split='SUPPLIER_REPORTED';
 if(r.provider==='DEEPSEEK_API'){
  totalInput=raw.prompt_tokens;output=raw.completion_tokens;
  if(raw.prompt_cache_hit_tokens!==undefined||raw.prompt_cache_miss_tokens!==undefined){
   read=raw.prompt_cache_hit_tokens;uncached=raw.prompt_cache_miss_tokens;
   if(!integer(read)||!integer(uncached)||read+uncached!==totalInput)throw fail('MODEL_USAGE_CACHE_INVALID');
  }else{uncached=totalInput;split='CACHE_UNKNOWN_CONSERVATIVE_MISS';}
  if(raw.total_tokens!==undefined&&raw.total_tokens!==totalInput+output)throw fail('MODEL_USAGE_TOTAL_INVALID');
 }else if(r.provider==='OPENAI_API'){
  totalInput=raw.input_tokens;output=raw.output_tokens;
  const detail=raw.input_tokens_details??{};read=detail.cached_tokens??0;
  if(raw.input_tokens_details===undefined||detail.cached_tokens===undefined||detail.cache_write_tokens===undefined)split='CACHE_BREAKDOWN_UNKNOWN_CONSERVATIVE_MAX';
  const written=detail.cache_write_tokens??0;
  writeShort=detail.cache_write_tokens_details?.ttl_30m_tokens??0;
  writeLong=detail.cache_write_tokens_details?.ttl_12h_tokens??0;
  if(!integer(written)||writeShort+writeLong!==written)throw fail('MODEL_USAGE_CACHE_INVALID');
  uncached=totalInput-read-written;thinking=raw.output_tokens_details?.reasoning_tokens??0;
  if(context.serviceTier!=='default')throw fail('MODEL_SERVICE_TIER_UNPRICED');
  if(raw.total_tokens!==undefined&&raw.total_tokens!==totalInput+output)throw fail('MODEL_USAGE_TOTAL_INVALID');
 }else if(r.provider==='ANTHROPIC_API'){
  uncached=raw.input_tokens;read=raw.cache_read_input_tokens??0;
  const written=raw.cache_creation_input_tokens??0;
  writeShort=raw.cache_creation?.ephemeral_5m_input_tokens??(written===0?0:null);
  writeLong=raw.cache_creation?.ephemeral_1h_input_tokens??(written===0?0:null);
  if(!integer(written)||!integer(writeShort)||!integer(writeLong)||writeShort+writeLong!==written)throw fail('MODEL_USAGE_CACHE_INVALID');
  totalInput=uncached+read+written;output=raw.output_tokens;
  thinking=raw.output_tokens_details?.thinking_tokens??0;
 }else{
  totalInput=raw.promptTokenCount;read=raw.cachedContentTokenCount??0;uncached=totalInput-read;
  thinking=raw.thoughtsTokenCount??0;output=(raw.candidatesTokenCount??0)+thinking;
  if((raw.toolUsePromptTokenCount??0)!==0)throw fail('MODEL_TOOL_USAGE_UNPRICED');
  if(raw.totalTokenCount!==undefined&&raw.totalTokenCount!==totalInput+output)throw fail('MODEL_USAGE_TOTAL_INVALID');
 }
 if(!integer(totalInput,48000)||totalInput<1||!integer(uncached,48000)||!integer(read,48000)||
   !integer(writeShort,48000)||!integer(writeLong,48000)||!integer(output,2048)||
   !integer(thinking,2048)||thinking>output||uncached+read+writeShort+writeLong!==totalInput)
  throw fail('MODEL_USAGE_INVALID');
 return Object.freeze({modelId,provider:r.provider,promptTokens:totalInput,completionTokens:output,totalTokens:totalInput+output,
  uncachedInputTokens:uncached,cacheReadTokens:read,cacheWriteShortTokens:writeShort,
  cacheWriteLongTokens:writeLong,thinkingTokens:thinking,cacheStatus:split,
  serviceTier:r.provider==='OPENAI_API'?(context.serviceTier??'default'):null});
}
export function quoteModelMaxKrw(modelId,inputTokens,outputTokens){
 const r=modelRate(modelId);
 if(!integer(inputTokens,48000)||inputTokens<1||!integer(outputTokens,2048)||outputTokens<1)throw fail('MODEL_QUOTE_TOKENS_INVALID');
 const nano=BigInt(inputTokens)*BigInt(Math.max(r.input,r.read,r.short,r.long))+BigInt(outputTokens)*BigInt(r.output);
 const won=Number(ceil(nano*BigInt(COST_FX_KRW)*BigInt(COST_BUFFER_BPS),10000000000000n));
 if(!Number.isSafeInteger(won)||won<1||won>10000)throw fail('MODEL_QUOTE_NOT_SAFE');
 return won;
}
export function priceModelUsage(modelId,usage){
 const r=modelRate(modelId),u=usage;
 if(!u||u.modelId!==modelId||u.provider!==r.provider||![u.promptTokens,u.completionTokens,u.uncachedInputTokens,u.cacheReadTokens,u.cacheWriteShortTokens,u.cacheWriteLongTokens].every(n=>integer(n))||u.promptTokens<1||
   u.promptTokens!==u.uncachedInputTokens+u.cacheReadTokens+u.cacheWriteShortTokens+u.cacheWriteLongTokens||
   u.promptTokens>48000||u.completionTokens>2048||u.totalTokens!==u.promptTokens+u.completionTokens||
   !integer(u.thinkingTokens,2048)||u.thinkingTokens>u.completionTokens||
   (['DEEPSEEK_API','GEMINI_API'].includes(r.provider)&&(u.cacheWriteShortTokens!==0||u.cacheWriteLongTokens!==0))||
   (r.provider==='OPENAI_API'&&u.serviceTier!=='default'))throw fail('MODEL_COST_USAGE_INVALID');
 const inputRate=u.cacheStatus==='CACHE_BREAKDOWN_UNKNOWN_CONSERVATIVE_MAX'?Math.max(r.input,r.read,r.short,r.long):r.input;
 const nano=BigInt(u.uncachedInputTokens)*BigInt(inputRate)+BigInt(u.cacheReadTokens)*BigInt(r.read)+BigInt(u.cacheWriteShortTokens)*BigInt(r.short)+BigInt(u.cacheWriteLongTokens)*BigInt(r.long)+BigInt(u.completionTokens)*BigInt(r.output);
 const estimate=Number(ceil(nano*BigInt(COST_FX_KRW),1000n));
 const upperNano=BigInt(u.promptTokens)*BigInt(Math.max(r.input,r.read,r.short,r.long))+BigInt(u.completionTokens)*BigInt(r.output);
 const conservative=Number(ceil(upperNano*BigInt(COST_FX_KRW)*BigInt(COST_BUFFER_BPS),10000000n));
 return Object.freeze({priceVersion:MODEL_COST_VERSION,priceBasis:u.cacheStatus==='CACHE_BREAKDOWN_UNKNOWN_CONSERVATIVE_MAX'?'UNREPORTED_CACHE_CONSERVATIVE_MAX_INPUT':modelId==='deepseek-flash'?'PEAK_CONSERVATIVE_ONLY':'STANDARD_TEXT_API',
  estimatedKrwMicros:estimate,conservativeKrwMicros:conservative,quotedNanoUsd:nano.toString(),
  estimatedKrwDisplay:Math.ceil(estimate/1e6),conservativeKrwDisplay:Math.max(1,Math.ceil(conservative/1e6)),
  fxKrwPerUsd:COST_FX_KRW,fxIsLive:false,invoiceReconciled:false,actualVendorChargeKrw:null});
}
export function publicRateTable(){return Object.values(MODEL_RATES).map(r=>({id:r.id,provider:r.provider,
 inputUsdPerToken:r.input/1e9,cacheReadUsdPerToken:r.read/1e9,cacheWriteShortUsdPerToken:r.short/1e9,
 cacheWriteLongUsdPerToken:r.long/1e9,outputUsdPerToken:r.output/1e9,priceVersion:MODEL_COST_VERSION}));}
