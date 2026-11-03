import {createVerifiedCustomerApi} from './customer-api-gateway.mjs';
import {validateCustomerOrigin} from './customer-origin-policy.mjs';
const fail=(status,code)=>({status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},body:JSON.stringify({code})});
const problem=(status,code)=>Object.assign(new Error(code),{status,code});
export function createCustomerHttpAdapter(dependencies,originConfig={}){
 const origin=validateCustomerOrigin(originConfig);
 const host=new URL(origin).host;
 let api;
 try{api=createVerifiedCustomerApi(dependencies,originConfig);}catch{}
 async function dispatch(req){
  try{
   const headers=new Headers(req.headers);
   // Never reconstruct trust from forwarding headers or browser identity fields.
   const raw=req.url;
   if(typeof raw!=='string'||raw.startsWith('//')||raw.includes('\\'))return fail(400,'INVALID_REQUEST_URL');
   const url=new URL(raw,origin);
   if(url.origin!==origin)return fail(403,'CUSTOMER_REQUEST_ORIGIN_INVALID');
   const method=req.method;
   if(!['GET','POST'].includes(method))return fail(405,'METHOD_NOT_ALLOWED');
   if(headers.get('host')!==host||
    (headers.has('x-forwarded-host')&&headers.get('x-forwarded-host')!==host)||
    (headers.has('x-forwarded-proto')&&headers.get('x-forwarded-proto')!=='https')||
    headers.has('x-original-url')||
    (headers.has('sec-fetch-site')&&!['none','same-origin'].includes(headers.get('sec-fetch-site'))))return fail(403,'CUSTOMER_REQUEST_ORIGIN_INVALID');
   if(method==='POST'&&(headers.get('origin')!==origin||!/^application\/json(?:\s*;|$)/i.test(headers.get('content-type')??'')))return fail(403,'CUSTOMER_POST_POLICY_INVALID');
   if(headers.has('content-encoding')&&headers.get('content-encoding')!=='identity')return fail(415,'CONTENT_ENCODING_NOT_SUPPORTED');
   const length=headers.get('content-length');
   if(length!==null&&(!/^\d+$/.test(length)||Number(length)>12000))return fail(413,'BODY_TOO_LARGE');
   let body;
   // Require raw streams: platform JSON parsing must be disabled.
   if(req.body!=null&&!(req instanceof Request))return fail(400,'RAW_BODY_REQUIRED');
   let size=0;const chunks=[];
   const stream=req instanceof Request?req.body:req;
   if(stream)for await(const chunk of stream){const b=Buffer.from(chunk);size+=b.length;if(size>12000)throw problem(413,'BODY_TOO_LARGE');chunks.push(b);}
   if(method==='GET'&&size)return fail(400,'GET_BODY_NOT_ALLOWED');
   if(method==='POST'){
    try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{return fail(400,'INVALID_JSON');}
    if(body===null||typeof body!=='object'||Array.isArray(body))return fail(400,'JSON_OBJECT_REQUIRED');
   }
   if(!api)return fail(503,'CUSTOMER_RUNTIME_NOT_CONNECTED');
   return await api({url:url.href,method,headers,body});
  }catch(error){return fail(error.status===413?413:503,error.status===413?'BODY_TOO_LARGE':'CUSTOMER_HTTP_UNAVAILABLE');}
 }
 return async(req,res)=>{
  const result=await dispatch(req);
  if(!res)return new Response(result.body,{status:result.status,headers:result.headers});
  res.statusCode=result.status;
  for(const [key,value]of Object.entries(result.headers))res.setHeader(key,value);
  return res.end(result.body);
 };
}
export default createCustomerHttpAdapter();
