// Managed password verification only. Passwords and provider tokens are never persisted.
const fail=(status,message,extra={})=>Object.assign(new Error(message),{status,...extra});
const denied=()=>fail(401,'이메일과 THE FA Core 비밀번호를 확인해 주세요.');
const emailOf=v=>typeof v==='string'?v.trim().toLowerCase():'';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function createManagedPasswordVerifier({url,key,allowedEmails,fetchImpl=globalThis.fetch,clock=Date.now}={}) {
 if(!/^https:\/\/[a-z\d]+\.supabase\.co$/.test(url||'')||typeof key!=='string'||key.length<20||!(allowedEmails instanceof Set)||typeof fetchImpl!=='function')throw Error('PASSWORD_PROVIDER_CONFIGURATION_REQUIRED');
 async function request(path,{method='GET',body,token}={}) {
  let response;
  try{response=await fetchImpl(url+'/auth/v1/'+path,{method,redirect:'error',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}
  catch{throw fail(503,'로그인 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  if(response.status===429){const seconds=Number(response.headers?.get('retry-after'));throw fail(429,'로그인 시도 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',{retryAfter:Number.isFinite(seconds)&&seconds>0?Math.min(3600,Math.ceil(seconds)):60});}
  if(response.status===400||response.status===401||response.status===403||response.status===422)throw denied();
  if(!response.ok)throw fail(503,'로그인 서비스를 현재 사용할 수 없습니다.');
  try{const raw=await response.text();if(Buffer.byteLength(raw)>65536)throw Error();return JSON.parse(raw);}catch{throw fail(503,'로그인 응답을 확인하지 못했습니다.');}
 }
 return async ({email:input,password}={})=>{
  const email=emailOf(input);
  if(!allowedEmails.has(email)||typeof password!=='string'||password.length<1||password.length>128||/[\u0000-\u001f\u007f]/.test(password))throw denied();
  const session=await request('token?grant_type=password',{method:'POST',body:{email,password}});
  if(typeof session.access_token!=='string'||!/^\S{20,16384}$/.test(session.access_token)||session.token_type?.toLowerCase()!=='bearer'||!Number.isSafeInteger(session.expires_in)||session.expires_in<1||session.expires_in>86400||!UUID.test(session.user?.id??''))throw fail(503,'로그인 응답을 확인하지 못했습니다.');
  const user=await request('user',{token:session.access_token});
  const verifiedEmail=emailOf(user?.email),confirmed=typeof user?.email_confirmed_at==='string'&&user.email_confirmed_at.trim()?Date.parse(user.email_confirmed_at):NaN;
  if(!UUID.test(user?.id??'')||user.id!==session.user.id||user.is_anonymous===true||verifiedEmail!==email||emailOf(session.user.email)!==email||!allowedEmails.has(verifiedEmail)||!Number.isFinite(confirmed)||confirmed>clock())throw denied();
  return Object.freeze({email:verifiedEmail,providerUserId:user.id,verified:true});
 };
}
