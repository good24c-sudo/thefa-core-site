import {createHash} from 'node:crypto';
import {resolveModel} from './model-catalog.mjs';
import {normalizeSupplierUsage,modelRate} from './customer-model-costs.mjs';

/** Server-only native provider adapters: fixed hosts, pinned model catalog, no retries. */
const endpoints=Object.freeze({
 deepseek:'https://api.deepseek.com/chat/completions',
 anthropic:'https://api.anthropic.com/v1/messages',
 openai:'https://api.openai.com/v1/responses',
 mistral:'https://api.mistral.ai/v1/chat/completions',
 gateway:'https://ai-gateway.vercel.sh/v1/chat/completions'
});
const fault=(code,status=503)=>Object.assign(new Error(code),{code,status});
const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const nonblank=x=>typeof x==='string'&&!!x.trim();
const sha=x=>createHash('sha256').update(x).digest('hex');
const keyMap=Object.freeze({
 deepseek:'CUSTOMER_DEEPSEEK_API_KEY',
 anthropic:'CUSTOMER_ANTHROPIC_API_KEY',
 google:'CUSTOMER_GEMINI_API_KEY',
 openai:'CUSTOMER_OPENAI_API_KEY',
 mistral:'CUSTOMER_MISTRAL_API_KEY',
 gateway:'AI_GATEWAY_API_KEY'
});
export function validatePromptMessages(messages){
 if(!Array.isArray(messages)||messages.length<1||messages.length>22)
  throw fault('AI_CONTEXT_INVALID',400);
 let bytes=0;
 const result=messages.map(m=>{
  if(!m||!['system','user','assistant'].includes(m.role)||!nonblank(m.content)||
     Buffer.byteLength(m.content,'utf8')>16000)throw fault('AI_CONTEXT_INVALID',400);
  bytes+=Buffer.byteLength(m.content,'utf8');
  return Object.freeze({role:m.role,content:m.content});
 });
 if(bytes>24000||result.at(-1).role!=='user')throw fault('AI_CONTEXT_LIMIT',400);
 return result;
}
function buildRequest(model,messages,maxTokens,secret){
 const id=model.upstreamModel;
 if(model.provider==='deepseek'||model.provider==='mistral'){
  return {url:endpoints[model.provider],
   headers:{authorization:'Bearer '+secret,'content-type':'application/json'},
   body:{model:id,messages,stream:false,max_tokens:maxTokens,
    ...(model.provider==='deepseek'?{thinking:{type:'disabled'}}:{})}};
 }
 if(model.provider==='anthropic'){
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const chat=messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content}));
  return {url:endpoints.anthropic,
   headers:{'x-api-key':secret,'anthropic-version':'2026-10-21','content-type':'application/json'},
   body:{model:id,system,messages:chat,max_tokens:maxTokens,stream:false}};
 }
 if(model.provider==='openai'){
  return {url:endpoints.openai,
   headers:{authorization:'Bearer '+secret,'content-type':'application/json'},
   body:{model:id,input:messages.map(m=>({role:m.role,content:m.content})),
    max_output_tokens:maxTokens,store:false,stream:false,service_tier:'default',
    ...(model.id==='gpt-6-luna'?{reasoning:{effort:'none'}}:{})}};
 }
 if(model.provider==='google'){
  if(!/^gemini-[a-z0-9.-]{5,40}$/.test(id))throw fault('AI_MODEL_NOT_ALLOWLISTED',400);
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const contents=messages.filter(m=>m.role!=='system')
    .map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
  return {url:'https://generativelanguage.googleapis.com/v1beta/models/'+id+':generateContent',
   headers:{'x-goog-api-key':secret,'content-type':'application/json'},
   body:{contents,systemInstruction:{parts:[{text:system||'Be helpful and accurate.'}]},
    generationConfig:{maxOutputTokens:maxTokens,candidateCount:1,
     ...(model.id==='gemini-3-1-flash-lite'?{thinkingConfig:{thinkingLevel:'MINIMAL'}}:{})}}};
 }
 if(model.provider==='gateway'&&model.transport==='gateway'){
  return {url:endpoints.gateway,
   headers:{authorization:'Bearer '+secret,'content-type':'application/json'},
   body:{model:id,messages,stream:false,max_tokens:maxTokens}};
 }
 throw fault('AI_PROVIDER_ADAPTER_NOT_AVAILABLE',503);
}
async function boundedJson(response){
 if(!response||typeof response.status!=='number')
  throw fault('AI_PROVIDER_TRANSPORT_UNKNOWN_NO_REPLAY');
 if(!response.ok)throw fault(response.status===429?'AI_PROVIDER_RATE_LIMITED_NO_REPLAY':
  'AI_PROVIDER_FAILURE_NO_REPLAY',response.status===429?429:503);
 const type=response.headers?.get?.('content-type')||'';
 if(type&&!/application\/json/i.test(type))throw fault('AI_PROVIDER_CONTENT_TYPE_INVALID',502);
 const raw=[];
 let size=0;
 try{
  if(!response.body)throw Error('NO_BODY');
  for await(const chunk of response.body){
   size+=chunk.length;
   if(size>160000)throw Error('TOO_LARGE');
   raw.push(Buffer.from(chunk));
  }
 }catch{throw fault('AI_PROVIDER_RESPONSE_UNCERTAIN_NO_REPLAY')}
 let value;try{value=JSON.parse(Buffer.concat(raw).toString('utf8'))}catch{
  throw fault('AI_PROVIDER_INVALID_JSON',502)}
 if(!value||typeof value!=='object'||Array.isArray(value))
  throw fault('AI_PROVIDER_INVALID_JSON',502);
 return value;
}
function decode(model,data){
 const rawUsage=model.provider==='google'?data.usageMetadata:data.usage;
 const returnedModel=data.model||data.modelVersion;
 const modelMatched=typeof returnedModel==='string'&&(returnedModel===model.upstreamModel||returnedModel.startsWith(model.upstreamModel+'-')); 
 let usage=null;
 try{usage=normalizeSupplierUsage(model.id,rawUsage,{serviceTier:data.service_tier});}catch{}
 const meteringReceipt=Object.freeze({modelId:model.id,model:model.upstreamModel,
  provider:modelRate(model.id).provider,normalizedUsage:modelMatched?usage:null,
  serviceTier:data.service_tier??null,providerResponseReceived:true});
 try{
  let content,stop;
  if(['deepseek','mistral','gateway'].includes(model.provider)){
   const c=data.choices?.[0];
   if(c?.message?.role!=='assistant'||!['stop','length'].includes(c.finish_reason)||c.message.tool_calls?.length)
    throw fault('AI_TOOL_OR_OUTPUT_UNSUPPORTED',502);
   content=c.message.content;stop=c.finish_reason;
  }else if(model.provider==='anthropic'){
   if(data.type!=='message'||!['end_turn','max_tokens'].includes(data.stop_reason)||
      !Array.isArray(data.content)||data.content.some(b=>!['text','thinking'].includes(b.type)))
    throw fault('AI_TOOL_OR_OUTPUT_UNSUPPORTED',502);
   content=data.content.filter(b=>b.type==='text').map(b=>b.text).join('');stop=data.stop_reason;
  }else if(model.provider==='openai'){
   if(!['completed','incomplete'].includes(data.status)||!Array.isArray(data.output)||
      data.output.some(x=>!['message','reasoning'].includes(x.type)))throw fault('AI_TOOL_OR_OUTPUT_UNSUPPORTED',502);
   const msg=data.output.filter(x=>x.type==='message');
   if(msg.length!==1||msg[0].role!=='assistant'||!Array.isArray(msg[0].content)||
      msg[0].content.some(x=>x.type!=='output_text'))throw fault('AI_TOOL_OR_OUTPUT_UNSUPPORTED',502);
   content=msg[0].content.map(x=>x.text).join('');stop=data.status;
  }else if(model.provider==='google'){
   const c=data.candidates?.[0];
   if(!['STOP','MAX_TOKENS'].includes(c?.finishReason)||!Array.isArray(c.content?.parts)||
      c.content.parts.some(x=>typeof x.text!=='string'))throw fault('AI_TOOL_OR_OUTPUT_UNSUPPORTED',502);
   content=c.content.parts.filter(x=>x.thought!==true).map(x=>x.text).join('');stop=c.finishReason;
  }else throw fault('AI_PROVIDER_ADAPTER_NOT_AVAILABLE',503);
  const returned=data.model||data.modelVersion;
  if(typeof returned!=='string'||(returned!==model.upstreamModel&&!returned.startsWith(model.upstreamModel+'-')))
   throw fault('AI_PROVIDER_MODEL_MISMATCH',502);
  if(!nonblank(content)||content.length>15000||!usage||usage.completionTokens<1)
   throw fault('AI_PROVIDER_USAGE_OR_CONTENT_INVALID',502);
  return Object.freeze({content:content.trim(),sha256:sha(content.trim()),
   model:model.upstreamModel,modelId:model.id,provider:modelRate(model.id).provider,
   promptTokens:usage.promptTokens,outputTokens:usage.completionTokens,normalizedUsage:usage,
   supplierUsage:usage,stopReason:stop,vendorInvoiceReconciled:false,actualVendorChargeKrw:null,
   truncated:['incomplete','length','max_tokens','MAX_TOKENS'].includes(stop),
   receiptState:'MODEL_RESPONSE_NOT_PERSISTED',noAutoRetry:true});
 }catch(error){
  // Never discard supplier usage merely because an answer is empty, refused or invalid.
  Object.defineProperty(error,'meteringReceipt',{value:meteringReceipt,enumerable:false});
  throw error;
 }
}
/** Permit verification is supplied only by the trusted, server-side admission gate.
 * Merely having a key, a user-supplied model ID, or a forged object can never authorize a call. */
export function createServerMultiAiAdapter({env={},fetchImpl=globalThis.fetch,
  modelId,verifyPermit,timeoutMs=45000,maxOutputTokens=1024}={}){
 const model=resolveModel(modelId);
 if(!['direct','gateway'].includes(model.transport))
  throw fault('AI_MODEL_SERVER_ADAPTER_NOT_AVAILABLE');
 if(model.provider==='gateway'&&env.CUSTOMER_AI_GATEWAY_ENABLED!=='true')
  throw fault('AI_GATEWAY_DISABLED_BY_POLICY');
 if(typeof verifyPermit!=='function'||typeof fetchImpl!=='function'||
   !integer(timeoutMs,60000)||timeoutMs<1000||!integer(maxOutputTokens,2048)||
   maxOutputTokens<16)throw fault('AI_ADAPTER_CONFIG_INVALID');
 const secret=env[keyMap[model.provider]];
 if(typeof secret!=='string'||secret.trim()!==secret||secret.length<16)
  throw fault('AI_PROVIDER_CREDENTIAL_UNAVAILABLE');
 async function ask({messages,permit}={}){
  if(verifyPermit(permit,{modelId:model.id})!==true)
   throw fault('AI_MODEL_CALL_NOT_AUTHORIZED',403);
  const clean=validatePromptMessages(messages);
  const request=buildRequest(model,clean,maxOutputTokens,secret);
  let response;
  try{
   response=await fetchImpl(request.url,{method:'POST',headers:request.headers,
    body:JSON.stringify(request.body),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  }catch{throw fault('AI_DISPATCH_OUTCOME_UNCERTAIN_NO_REPLAY')}
  const parsed=await boundedJson(response);
  return decode(model,parsed);
 }
 return Object.freeze({modelId:model.id,provider:model.provider,
  ask,endpointValidated:true,noAutomaticFallback:true});
}
