/**
 * THE FA Core multi-AI model catalogue R1 (2026-11-18).
 * Identifiers are allowlisted from official supplier docs and current
 * Vercel AI Gateway catalogue. Do not imply account/model access.
 * Customer billing is not connected. Every non-free model is locked.
 */
const entries=[
 ['deepseek-flash','deepseek','deepseek-flash','DeepSeek Flash','free','direct','기본 AI · 현재 고객 채팅'],
 ['deepseek-v4-pro','deepseek','deepseek-v4-pro','DeepSeek V4 Pro','premium','direct','고급 추론'],
 ['claude-haiku-5-5','anthropic','claude-haiku-5-5','Claude Haiku 5.5','premium','direct','빠른 일반 업무'],
 ['claude-sonnet-5-5','anthropic','claude-sonnet-5-5','Claude Sonnet 5.5','premium','direct','분석·코딩'],
 ['claude-opus-5-5','anthropic','claude-opus-5-5','Claude Opus 5.5','premium','direct','고난도 업무'],
 ['gemini-3-6-flash','google','gemini-3.6-flash','Gemini 3.6 Flash','premium','direct','빠른 멀티모달'],
 ['gemini-3-1-flash-lite','google','gemini-3.1-flash-lite','Gemini 3.1 Flash Lite','premium','direct','저원가 대화'],
 ['gpt-6-luna','openai','gpt-6-luna','GPT-6 Luna','premium','direct','초경량 응답'],
 ['gpt-6-2-sol','openai','gpt-6.2-sol','GPT-6.2 Sol','premium','direct','고품질 분석'],
 ['gpt-6-2-astra','openai','gpt-6.2-astra','GPT-6.2 Astra','premium','direct','심층 작업'],
 ['mistral-large-4','mistral','mistral-large-4','Mistral Large 4','premium','direct','대화·개발'],
 ['grok-4-20','gateway','spacexai/grok-4.20-non-reasoning','xAI Grok 4.20','premium','gateway','Gateway 준비'],
 ['qwen3-max','gateway','alibaba/qwen3-max-thinking','Alibaba Qwen3 Max','premium','gateway','Gateway 준비'],
 ['kimi-k3','gateway','moonshotai/kimi-k3','Moonshot Kimi K3','premium','gateway','Gateway 준비'],
 ['perplexity-sonar','gateway','perplexity/sonar','Perplexity Sonar','premium','gateway','Gateway 준비'],
 ['meta-llama-4-maverick','gateway','meta/llama-4-maverick','Meta Llama 4 Maverick','premium','gateway','Gateway 준비'],
 ['zai-glm-5','gateway','zai/glm-5','Z.AI GLM 5','premium','gateway','Gateway 준비'],
 ['minimax-m3','gateway','minimax/minimax-m3','MiniMax M3','premium','gateway','Gateway 준비'],
 ['qwen3-coder-next','gateway','alibaba/qwen3-coder-next','Qwen3 Coder Next','premium','gateway','Gateway 준비'],
 ['qwen-local-tools','ollama','thefa-qwen3-tools-r2:4b','Qwen3 Tools (4070 PC)','local','broker','로컬 장치 연결 필요'],
 ['qwen-local-7b','ollama','qwen2.5:7b-instruct','Qwen 2.5 7B (4070 PC)','local','broker','로컬 장치 연결 필요'],
 ['qwen-coder-7b','ollama','qwen2.5-coder:7b','Qwen Coder 7B (4070 PC)','local','broker','로컬 장치 연결 필요'],
 ['qwen3-4b','ollama','qwen3:4b','Qwen3 4B (4070 PC)','local','broker','로컬 장치 연결 필요']
];
export const PROVIDERS=Object.freeze([
 {id:'deepseek',name:'DeepSeek',env:'CUSTOMER_DEEPSEEK_API_KEY',class:'direct'},
 {id:'anthropic',name:'Claude / Anthropic',env:'CUSTOMER_ANTHROPIC_API_KEY',class:'direct'},
 {id:'google',name:'Gemini / Google',env:'CUSTOMER_GEMINI_API_KEY',class:'direct'},
 {id:'openai',name:'OpenAI',env:'CUSTOMER_OPENAI_API_KEY',class:'direct'},
 {id:'mistral',name:'Mistral',env:'CUSTOMER_MISTRAL_API_KEY',class:'direct'},
 {id:'gateway',name:'Vercel AI Gateway · xAI/Qwen/Kimi/Perplexity 및 추가 제공자',
    env:'AI_GATEWAY_API_KEY',class:'gateway'},
 {id:'ollama',name:'THE FA Local Ollama',env:null,class:'local'},
 {id:'groq',name:'Groq',env:'CUSTOMER_GROQ_API_KEY',class:'future'},
 {id:'cerebras',name:'Cerebras',env:'CUSTOMER_CEREBRAS_API_KEY',class:'future'},
 {id:'together',name:'Together AI',env:'CUSTOMER_TOGETHER_API_KEY',class:'future'},
 {id:'openrouter',name:'OpenRouter',env:'CUSTOMER_OPENROUTER_API_KEY',class:'future'}
].map(p=>Object.freeze(p)));
export const CATALOG=Object.freeze(entries.map(e=>Object.freeze({
 id:e[0],provider:e[1],upstreamModel:e[2],label:e[3],
 entitlement:e[4],transport:e[5],description:e[6],
 allowAutomaticFallback:false
})));
const has=Object.fromEntries(PROVIDERS.map(p=>[p.id,p]));
const fault=code=>Object.assign(new Error(code),{code});
export function resolveModel(id){
 const model=CATALOG.find(x=>x.id===id);
 if(!model)throw fault('MODEL_NOT_ALLOWLISTED');
 return model;
}
const bool=x=>x===true;
const credentials=(env,p)=>!!p.env&&typeof env[p.env]==='string'&&env[p.env].trim().length>=16;
export function safeProviderStatus({env={},operationalDeepSeek=false,
  verifiedGatewayBudget=false,verifiedGatewayAuth=false,
  verifiedModelCanaries=[],localBrokerVerified=false,paidEntitlementVerified=false,
  verifiedCostReservation=false,premiumDispatchConnected=false,
  free10BudgetVerified=false}={}){
 if(!env||typeof env!=='object'||Array.isArray(env)||Object.getPrototypeOf(env)!==Object.prototype)
  throw fault('PROVIDER_ENV_CONTEXT_INVALID');
 if(!Array.isArray(verifiedModelCanaries)||verifiedModelCanaries.some(x=>typeof x!=='string'))
  throw fault('CANARY_EVIDENCE_INVALID');
 const verifiedSet=new Set(verifiedModelCanaries);
 const result=PROVIDERS.map(p=>{
  const configured=credentials(env,p);
  const canaries=CATALOG.filter(x=>x.provider===p.id&&verifiedSet.has(x.id));
  let state='API_NOT_CONNECTED';
  if(p.class==='local')state=localBrokerVerified?'LOCAL_BROKER_VERIFIED':'LOCAL_PC_ONLY_NOT_WEB_CONNECTED';
  else if(p.class==='gateway'){
   state=configured&&verifiedGatewayBudget&&verifiedGatewayAuth?'GATEWAY_ACCOUNT_VERIFIED':
    configured?'GATEWAY_BILLING_OR_AUTH_UNVERIFIED':'GATEWAY_UNAVAILABLE';
  }else if(p.id==='deepseek'){
   state=configured&&operationalDeepSeek?'OPERATING_EXISTING_MODEL':
    configured?'CREDENTIAL_REGISTERED_NOT_CANARY_VERIFIED':'API_NOT_CONNECTED';
  }else if(configured){
   state=canaries.length?'MODEL_CANARY_VERIFIED':'CREDENTIAL_REGISTERED_NOT_CANARY_VERIFIED';
  }
  return {id:p.id,name:p.name,state,hasCredential:configured,
    linkedToCustomerSite:p.id==='deepseek'&&configured&&operationalDeepSeek};
 });
 const providers=Object.fromEntries(result.map(p=>[p.id,p]));
 const models=CATALOG.map(m=>{
  const provider=providers[m.provider];
  const nativeAvailable=m.id==='deepseek-flash'&&
   provider.state==='OPERATING_EXISTING_MODEL'&&bool(free10BudgetVerified);
  const verifiedDirect=provider.state==='MODEL_CANARY_VERIFIED'&&verifiedSet.has(m.id);
  const verifiedGateway=m.transport==='gateway'&&provider.state==='GATEWAY_ACCOUNT_VERIFIED'&&
   verifiedSet.has(m.id);
  const paidAvailable=bool(paidEntitlementVerified)&&bool(verifiedCostReservation)&&
   bool(premiumDispatchConnected)&&
   (verifiedDirect||verifiedGateway);
  const active=nativeAvailable||paidAvailable;
  let reason=active?'SERVER_GATED_AVAILABLE':'';
  if(!active&&m.transport==='broker')reason='LOCAL_BROKER_NOT_CONNECTED_OR_UNAUTHORIZED';
  else if(!active&&m.transport==='catalogOnly')reason='MODEL_ID_UNVERIFIED';
  else if(!active&&m.entitlement==='premium'&&!paidEntitlementVerified)reason='PAID_ENTITLEMENT_NOT_CONNECTED';
  else if(!active&&m.entitlement==='free')reason='FREE10_OR_EXISTING_PROVIDER_NOT_VERIFIED';
  else if(!active)reason='PROVIDER_API_CANARY_OR_COST_GATE_UNVERIFIED';
  return Object.freeze({...m,available:active,status:reason,
   accountPricingVerified:false,vendorInvoiceReconciled:false});
 });
 return Object.freeze({
  contract:'THEFA_CORE_MULTI_AI_MODEL_CATALOG_R1',
  hasVerifiedPaidBilling:bool(paidEntitlementVerified),
  providers:Object.freeze(result.map(p=>Object.freeze(p))),
  models:Object.freeze(models),apiKeysIncluded:false,
  unknownModelsMayBeAddedLater:true
 });
}
