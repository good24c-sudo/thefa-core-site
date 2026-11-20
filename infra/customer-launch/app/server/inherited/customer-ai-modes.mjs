import {createServerMultiAiAdapter} from './provider-adapters.mjs';
import {modelRate} from './customer-model-costs.mjs';
const MODES=Object.freeze([
 {id:'balanced',label:'더파 기본',description:'일상 질문과 균형 있는 답변',modelId:'deepseek-flash',key:'CUSTOMER_DEEPSEEK_API_KEY'},
 {id:'quick',label:'빠른 실무',description:'간결한 정리와 빠른 업무 처리',modelId:'gpt-6-luna',key:'CUSTOMER_OPENAI_API_KEY'},
 {id:'writing',label:'글쓰기·분석',description:'문서 작성과 논리적인 검토',modelId:'claude-haiku-5-5',key:'CUSTOMER_ANTHROPIC_API_KEY'},
 {id:'research',label:'종합 대화',description:'정보 정리와 다양한 관점의 대화',modelId:'gemini-3-1-flash-lite',key:'CUSTOMER_GEMINI_API_KEY'}
].map(Object.freeze));
export function resolveCustomerAiMode(id='balanced'){
 const mode=MODES.find(x=>x.id===id);
 if(!mode)throw Object.assign(Error('CUSTOMER_AI_MODE_INVALID'),{status:400,code:'CUSTOMER_AI_MODE_INVALID'});
 return mode;
}
/** Existing native adapters and the existing shared budget are the only dispatch path. */
export function createCustomerAiModes({env,budget,fetchImpl=globalThis.fetch}={}){
 if(typeof budget?.consumeProviderPermit!=='function')throw Error('CUSTOMER_AI_BUDGET_PERMIT_REQUIRED');
 const hasKey=m=>typeof env?.[m.key]==='string'&&env[m.key].trim().length>=16;
 function list(){return MODES.map(m=>({id:m.id,label:m.label,description:m.description,
  available:hasKey(m),status:hasKey(m)?'AVAILABLE':'CONNECTION_PENDING',
  usesSharedFreeAllowance:true,automaticFallback:false}));}
 function providerFor(id='balanced'){
  const m=resolveCustomerAiMode(id);
  if(!hasKey(m))throw Object.assign(Error('CUSTOMER_AI_MODE_UNAVAILABLE'),{status:503,code:'CUSTOMER_AI_MODE_UNAVAILABLE'});
  const native=createServerMultiAiAdapter({env,fetchImpl,modelId:m.modelId,
   maxOutputTokens:1024,verifyPermit:budget.consumeProviderPermit});
  return Object.freeze({mode:'THEFA_CUSTOMER_MULTI_AI',aiMode:m.id,modelId:m.modelId,
   model:m.modelId==='gemini-3-1-flash-lite'?'gemini-3.1-flash-lite':m.modelId,
   provider:modelRate(m.modelId).provider,maxOutputTokens:1024,ask:native.ask});
 }
 return Object.freeze({list,providerFor,defaultMode:'balanced'});
}
