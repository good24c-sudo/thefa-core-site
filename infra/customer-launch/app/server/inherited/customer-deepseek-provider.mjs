import {createHash} from 'node:crypto';

const failure=(status,code)=>Object.assign(new Error(code),{status,code});
const models=new Set(['deepseek-flash','deepseek-v4-pro']);
const size=x=>Buffer.byteLength(x,'utf8');
const tokenCount=x=>Number.isSafeInteger(x)&&x>=0?x:null;

// Fixed provider endpoint; callers never select a host or transmit credentials to a browser.
export function createCustomerDeepSeekProvider({apiKey,model='deepseek-flash',
  maxTokens=1024,timeoutMs=45000,fetchImpl=globalThis.fetch}={}){
  if(typeof apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{16,200}$/.test(apiKey)||
    !models.has(model)||!Number.isSafeInteger(maxTokens)||maxTokens<32||maxTokens>2048||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000||typeof fetchImpl!=='function')
    throw failure(503,'DEEPSEEK_CONFIGURATION_REQUIRED');
  async function ask({messages}={}){
    if(!Array.isArray(messages)||messages.length<1||messages.length>22)
      throw failure(400,'MODEL_CONTEXT_INVALID');
    let bytes=0;
    const context=messages.map(m=>{
      if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||
         !m.content.trim()||size(m.content)>16000)throw failure(400,'MODEL_CONTEXT_INVALID');
      bytes+=size(m.content);return {role:m.role,content:m.content};
    });
    if(bytes>24000||context.at(-1).role!=='user')throw failure(400,'MODEL_CONTEXT_LIMIT');
    const started=Date.now();
    let response;
    try{response=await fetchImpl('https://api.deepseek.com/chat/completions',{
      method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},
      body:JSON.stringify({model,messages:context,stream:false,max_tokens:maxTokens,
        thinking:{type:'disabled'}}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)
    });}catch{throw failure(503,'DEEPSEEK_REQUEST_UNCERTAIN_NO_RETRY');}
    if(!response?.ok)throw failure(response?.status===429?429:503,'DEEPSEEK_PROVIDER_UNAVAILABLE');
    let raw='';
    try{
      // Enforce the limit while reading, rather than allocating an unbounded response.text().
      const chunks=[];let n=0;
      for await(const chunk of response.body){n+=chunk.length;
        if(n>100000)throw new Error('SIZE');chunks.push(chunk);}
      raw=Buffer.concat(chunks).toString('utf8');
    }catch{throw failure(502,'DEEPSEEK_RESPONSE_INVALID');}
    let data;try{data=JSON.parse(raw);}catch{throw failure(502,'DEEPSEEK_RESPONSE_INVALID');}
    const choice=data?.choices?.[0],text=choice?.message?.content;
    if(data.model!==model||!['stop','length'].includes(choice?.finish_reason)||
      choice?.message?.role!=='assistant'||typeof text!=='string'||!text.trim()||
      text.trim().length>15000)throw failure(502,'DEEPSEEK_RESPONSE_INVALID');
    const content=text.trim();
    console.info(JSON.stringify({code:"CUSTOMER_MODEL_TIMING",provider:"DEEPSEEK_API",model,elapsedMs:Date.now()-started}));
    return {content,model,provider:'DEEPSEEK_API',
      sha256:createHash('sha256').update(content).digest('hex'),
      promptTokens:tokenCount(data.usage?.prompt_tokens),outputTokens:tokenCount(data.usage?.completion_tokens),
      truncated:choice.finish_reason==='length',receiptClass:'MODEL_RESPONSE_ONLY_NOT_OFFICIAL_TERMINAL'};
  }
  return Object.freeze({model,mode:'DEEPSEEK_CUSTOMER_CHAT',maxOutputTokens:maxTokens,ask});
}
