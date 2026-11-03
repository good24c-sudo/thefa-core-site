import {validateCustomerOrigin} from './customer-origin-policy.mjs';

const failure=(status,code)=>Object.assign(new Error(code),{status,code});
const json=(status,code)=>Response.json({code},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const headerName=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function readHeaders(req){
 if(!Array.isArray(req.rawHeaders)||!req.rawHeaders.length||req.rawHeaders.length%2||req.rawHeaders.length>200)
  throw failure(400,'CUSTOMER_RAW_HEADERS_REQUIRED');
 const h=new Headers(),seen=new Set();let size=0;
 for(let i=0;i<req.rawHeaders.length;i+=2){
  const name=req.rawHeaders[i],value=req.rawHeaders[i+1];
  if(typeof name!=='string'||!headerName.test(name)||typeof value!=='string'||/[\r\n\x00]/.test(value)||seen.has(name.toLowerCase()))
   throw failure(400,'CUSTOMER_RAW_HEADERS_INVALID');
  size+=Buffer.byteLength(name+value);if(size>8192)throw failure(431,'CUSTOMER_HEADERS_TOO_LARGE');
  seen.add(name.toLowerCase());h.set(name,value);
 }
 return h;
}
async function readBody(req,limit){
 if(typeof req.on!=='function'||typeof req.removeListener!=='function')throw failure(400,'CUSTOMER_RAW_STREAM_REQUIRED');
 return new Promise((resolve,reject)=>{
  let length=0;const chunks=[];
  const cleanup=()=>{for(const [event,fn]of [['data',data],['end',end],['aborted',aborted],['error',error]])req.removeListener(event,fn)};
  const error=()=>{cleanup();reject(failure(400,'CUSTOMER_REQUEST_STREAM_INVALID'))};
  const aborted=error;
  const data=chunk=>{
   const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
   if(length>limit){cleanup();req.once('error',()=>{});req.resume();reject(failure(413,'CUSTOMER_BODY_TOO_LARGE'));return}
   chunks.push(bytes);
  };
  const end=()=>{cleanup();resolve(Buffer.concat(chunks,length))};
  req.on('data',data);req.once('end',end);req.once('aborted',aborted);req.once('error',error);
 });
}
async function send(res,response){
 if(!(response instanceof Response))response=json(503,'CUSTOMER_APPLICATION_UNAVAILABLE');
 res.statusCode=response.status;
 for(const [name,value]of response.headers)if(name!=='set-cookie')res.setHeader(name,value);
 const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
 const data=Buffer.from(await response.arrayBuffer());res.end(data);
}

/** Pure raw Node request boundary. No exported live binding, listener, Host-derived
 * configuration, credential enrollment, OAuth setup, or deployment is performed.
 * A platform using this adapter must disable its body parser.
 */
export function createCustomerNodeAdapter({application,customerOrigin,environment}={}){
 let origin,host,ready=false;
 try{origin=validateCustomerOrigin({customerOrigin,environment});host=new URL(origin).host;ready=typeof application==='function'}catch{}
 return async(req,res)=>{
  let response;
  try{
   if(!ready){await send(res,json(503,'CUSTOMER_PUBLIC_RUNTIME_NOT_CONNECTED'));return}
   if(req.body!==undefined&&req.body!==null)throw failure(400,'CUSTOMER_RAW_BODY_REQUIRED');
   const raw=req.url,method=req.method;
   if(typeof raw!=='string'||raw.length>8192||!raw.startsWith('/')||raw.startsWith('//')||/[\r\n#\\]/.test(raw)||
     raw.split('?')[0].includes('%')||/(?:^|\/)\.{1,2}(?:\/|$)/.test(raw.split('?')[0]))throw failure(400,'CUSTOMER_RAW_URL_INVALID');
   if(!['GET','POST'].includes(method))throw failure(405,'METHOD_NOT_ALLOWED');
   const headers=readHeaders(req);
   if(headers.get('host')!==host||headers.has('forwarded')||headers.has('x-original-url')||
     (headers.has('x-forwarded-host')&&headers.get('x-forwarded-host')!==host)||
     (headers.has('x-forwarded-proto')&&headers.get('x-forwarded-proto')!=='https')){
     console.error(JSON.stringify({code:'CUSTOMER_NODE_ORIGIN_REJECTED',hostMatches:headers.get('host')===host,forwardedHostMissing:!headers.has('x-forwarded-host'),forwardedHostMatches:headers.get('x-forwarded-host')===host,forwardedProtoMissing:!headers.has('x-forwarded-proto'),forwardedProtoHttps:headers.get('x-forwarded-proto')==='https',forwardedPresent:headers.has('forwarded'),originalUrlPresent:headers.has('x-original-url')}));
     throw failure(403,'CUSTOMER_REQUEST_ORIGIN_INVALID');
   }
   const declared=headers.get('content-length'),transfer=headers.get('transfer-encoding');
   if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))throw failure(400,'CUSTOMER_CONTENT_LENGTH_INVALID');
   if(declared!==null&&Number(declared)>12000)throw failure(413,'CUSTOMER_BODY_TOO_LARGE');
   if((declared!==null&&transfer!==null)||(transfer!==null&&transfer.toLowerCase()!=='chunked'))throw failure(400,'CUSTOMER_TRANSFER_ENCODING_INVALID');
   const body=await readBody(req,12000);
   if(declared!==null&&Number(declared)!==body.length)throw failure(400,'CUSTOMER_CONTENT_LENGTH_INVALID');
   if(method==='GET'&&body.length)throw failure(400,'CUSTOMER_GET_BODY_INVALID');
   headers.delete('transfer-encoding');
   const url=new URL(raw,origin);if(url.origin!==origin)throw failure(403,'CUSTOMER_REQUEST_ORIGIN_INVALID');
   response=await application(new Request(url.href,{method,headers,...(method==='POST'?{body}:{} )}));
  }catch(error){response=json(Number.isInteger(error?.status)?error.status:503,typeof error?.code==='string'?error.code:'CUSTOMER_PUBLIC_RUNTIME_UNAVAILABLE')}
  await send(res,response);
 };
}
