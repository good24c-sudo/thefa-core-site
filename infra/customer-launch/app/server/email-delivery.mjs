import {randomUUID} from 'node:crypto';
import {normalizeLaunchEmail} from './fresh-launch-accounts.mjs';
const error=code=>Object.assign(new Error(code),{code,status:503});
/** A deployment configures the approved sender and private key. This factory
 * reads no disk, creates no key, sends nothing until the authenticated route
 * requests an OTP, and never retries an uncertain provider write. */
export function createCustomerEmailDelivery({env=process.env,fetchImpl=globalThis.fetch}={}){
 const names=['CUSTOMER_EMAIL_PROVIDER','CUSTOMER_EMAIL_FROM','CUSTOMER_EMAIL_API_KEY'];
 if(names.every(name=>env?.[name]===undefined))return undefined;
 let from,key;
 try{
  if(env?.CUSTOMER_EMAIL_PROVIDER!=='resend'||typeof fetchImpl!=='function')throw Error();
  from=normalizeLaunchEmail(env.CUSTOMER_EMAIL_FROM);key=env.CUSTOMER_EMAIL_API_KEY;
  if(typeof key!=='string'||!/^re_[A-Za-z0-9_-]{16,200}$/.test(key))throw Error();
 }catch{throw error('EMAIL_DELIVERY_CONFIGURATION_INVALID');}
 return async({email,otp,type}={})=>{
  try{email=normalizeLaunchEmail(email);if(type!=='sign-in'||typeof otp!=='string'||!/^\d{6}$/.test(otp))throw Error();}
  catch{throw error('EMAIL_DELIVERY_REQUEST_INVALID');}
  try{
   const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','Idempotency-Key':'thefa-auth-'+randomUUID()},
    body:JSON.stringify({from,to:[email],subject:'THE FA Core 로그인 인증번호',text:'THE FA Core 인증번호: '+otp+'\n\n이 인증번호는 5분 동안 한 번만 사용할 수 있습니다. 요청하지 않으셨다면 이 메일을 무시해 주세요. 인증번호를 다른 사람에게 알려주지 마세요.'}),
    redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!(response instanceof Response)||response.status<200||response.status>=300||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error();
   const size=response.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>4096)||!response.body)throw Error();
   const reader=response.body.getReader(),chunks=[];let total=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>4096){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}}
   finally{reader.releaseLock();}
   const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(typeof result?.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.id))throw Error();
   return Object.freeze({accepted:true,delivered:false});
  }catch{throw error('EMAIL_DELIVERY_UNAVAILABLE');}
 };
}
