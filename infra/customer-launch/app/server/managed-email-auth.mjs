import {createHmac,randomBytes,createCipheriv,createDecipheriv,hkdfSync} from 'node:crypto';
import {validateCustomerOrigin} from './inherited/customer-origin-policy.mjs';
import {normalizeLaunchEmail} from './fresh-launch-accounts.mjs';
const COOKIE='__Host-thefa_customer_email';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECTS={production:'https://cgrppxfdurpzzfvkmfte.supabase.co',staging:'https://furfjhymxqsbhvuyeqpx.supabase.co'};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const cookie=(value,seconds)=>COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+seconds;
function json(value,status=200,cookies=[]){const h=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});for(const c of cookies)h.append('set-cookie',c);return new Response(JSON.stringify(value),{status,headers:h});}
async function boundedJson(response,limit=32768){
 const n=response.headers.get('content-length');if(n!==null&&(!/^\d+$/.test(n)||Number(n)>limit))throw fail('AUTH_RESPONSE_TOO_LARGE');
 let size=0;const pieces=[];if(response.body)for await(const c of response.body){size+=c.length;if(size>limit)throw fail('AUTH_RESPONSE_TOO_LARGE');pieces.push(Buffer.from(c));}
 if(!size)return {};try{return JSON.parse(Buffer.concat(pieces).toString('utf8'))}catch{throw fail('AUTH_RESPONSE_INVALID')}
}
/** Thin server adapter to existing Supabase Auth. Never stores passwords or mints provider identity. */
export function createManagedEmailAuth({config,publishableKey,cookieSecret,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const origin=validateCustomerOrigin(config),host=new URL(origin).host;
 if(config.accountMode!=='fresh-launch'||config.supabaseUrl!==PROJECTS[config.environment]||
  typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)||
  typeof cookieSecret!=='string'||cookieSecret.length<32||cookieSecret.length>8192||
  !Buffer.isBuffer(config.accountSecret)||config.accountSecret.length!==32||typeof fetchImpl!=='function'||typeof clock!=='function')
  throw fail('MANAGED_EMAIL_AUTH_CONFIGURATION_INVALID');
 const issuer=config.supabaseUrl+'/auth/v1';
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(cookieSecret),Buffer.from('THEFA_MANAGED_AUTH_COOKIE_V1'),Buffer.from(origin),32));
 function seal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),b=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);const out=Buffer.concat([iv,c.getAuthTag(),b]).toString('base64url');if(out.length>3700)throw fail('AUTH_SESSION_TOO_LARGE');return out;}
 function ticket(header){
  if(typeof header!=='string'||header.length>8192)return null;
  const matches=header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));if(matches.length!==1)return null;
  const raw=matches[0].slice(COOKIE.length+1);if(!/^[A-Za-z0-9_-]{50,3700}$/.test(raw))return null;
  try{const b=Buffer.from(raw,'base64url');if(b.toString('base64url')!==raw)return null;const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));const t=JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));const now=Math.floor(clock()/1000);
   return t.origin===origin&&t.issuer===issuer&&UUID.test(t.uid||'')&&typeof t.access==='string'&&t.access.length<=2800&&Number.isSafeInteger(t.issued)&&Number.isSafeInteger(t.expires)&&t.issued<=now+30&&t.expires>now&&t.expires-t.issued<=3600?t:null;
  }catch{return null;}
 }
 async function upstream(route,{body,access,method=body===undefined?'GET':'POST'}={}){
  const h={'apikey':publishableKey,'accept':'application/json'};if(body!==undefined)h['content-type']='application/json';if(access)h.authorization='Bearer '+access;
  try{const r=await fetchImpl(issuer+route,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});return {status:r.status,data:await boundedJson(r)};}
  catch{throw fail('AUTH_PROVIDER_UNAVAILABLE')}
 }
 function confirmed(user){return plain(user)&&UUID.test(user.id||'')&&typeof user.email_confirmed_at==='string'&&Number.isFinite(Date.parse(user.email_confirmed_at))&&typeof user.email==='string'&&user.is_anonymous!==true;}
 async function verified(t){if(!t)return null;const r=await upstream('/user',{access:t.access});if([400,401,403,404].includes(r.status))return null;if(r.status!==200)throw fail('AUTH_SESSION_VALIDATION_UNAVAILABLE');return confirmed(r.data)&&r.data.id===t.uid?r.data:null;}
 function principal(user){const id=createHmac('sha256',config.accountSecret).update('THEFA_SUPABASE_EMAIL_CUSTOMER_V1|'+issuer+'|'+user.id).digest('hex');const display=typeof user.user_metadata?.name==='string'?user.user_metadata.name.slice(0,80):'내 계정';return Object.freeze({principalId:id,workspaceEmail:'account_'+id+'@accounts.thefa.invalid',provider:'email',sessionVerified:true,accountProvenance:'LAUNCH_ACCOUNT_CONFIRMED',user:{id:user.id,displayName:display,provider:'email'}});}
 async function sessionVerifier(header){const u=await verified(ticket(header));return u?principal(u):null;}
 async function authRoutes(request){
  try{
   if(!(request instanceof Request))return json({code:'AUTH_REQUEST_INVALID'},400);
   const u=new URL(request.url),h=request.headers;
   if(u.origin!==origin||h.get('host')!==host||u.search||u.hash||h.has('forwarded')||h.has('x-original-url')||
    (h.has('x-forwarded-host')&&h.get('x-forwarded-host')!==host)||
    (h.has('x-forwarded-proto')&&h.get('x-forwarded-proto')!=='https'))return json({code:'AUTH_ORIGIN_INVALID'},403);
   const methods={'/api/auth/providers':'GET','/api/auth/session':'GET','/auth/email/signup':'POST','/auth/email/login':'POST','/auth/email/resend':'POST','/auth/logout':'POST'};
   if(!methods[u.pathname])return json({code:'AUTH_METHOD_NOT_CONNECTED'},404);
   if(request.method!==methods[u.pathname])return json({code:'METHOD_NOT_ALLOWED'},405);
   if(request.method==='POST'&&(h.get('origin')!==origin||!/^application\/json(?:\s*;|$)/i.test(h.get('content-type')||'')||
    (h.has('sec-fetch-site')&&!['same-origin','none'].includes(h.get('sec-fetch-site')))))return json({code:'AUTH_CSRF_INVALID'},403);
   if(u.pathname==='/api/auth/providers')return json({issuer,email:{enabled:true,method:'password-confirmed'},providers:[{id:'google',label:'Google',enabled:false},{id:'kakao',label:'카카오',enabled:false}],accountMode:'fresh-launch'});
   if(u.pathname==='/api/auth/session'){const p=await sessionVerifier(h.get('cookie')||'');return json({authenticated:!!p,user:p?.user||null,method:'email',accountLinked:!!p});}
   let body;try{body=await boundedJson(request,2048);if(!plain(body))throw Error();}catch{return json({code:'AUTH_PAYLOAD_INVALID'},400);}
   if(u.pathname==='/auth/logout'){
    if(Object.keys(body).length)return json({code:'AUTH_PAYLOAD_INVALID'},400);
    const t=ticket(h.get('cookie')||'');let revoked=true;
    if(t)try{const r=await upstream('/logout?scope=local',{access:t.access,method:'POST'});revoked=[200,204,401,403].includes(r.status);}catch{revoked=false;}
    return json({success:true,serverSessionRevoked:revoked},200,[cookie('',0)]);
   }
   const signup=u.pathname==='/auth/email/signup',resend=u.pathname==='/auth/email/resend';
   const allowed=resend?['email']:signup?['email','password','name']:['email','password'];
   if(Object.keys(body).some(k=>!allowed.includes(k)))return json({code:'AUTH_PAYLOAD_INVALID'},400);
   let email;try{email=normalizeLaunchEmail(body.email);}catch{return json({code:'EMAIL_INVALID'},400);}
   if(!resend&&(typeof body.password!=='string'||body.password.length<(signup?12:1)||body.password.length>128||/[\x00-\x1f\x7f]/.test(body.password)))return json({code:signup?'PASSWORD_REQUIREMENTS':'AUTH_PAYLOAD_INVALID'},400);
   if(signup&&body.name!==undefined&&(typeof body.name!=='string'||body.name.length>80||/[\x00-\x1f\x7f]/.test(body.name)))return json({code:'AUTH_PAYLOAD_INVALID'},400);
   if(signup||resend){
    const route=signup?'/signup?redirect_to='+encodeURIComponent(origin+'/login'):'/resend?redirect_to='+encodeURIComponent(origin+'/login');
    const payload=signup?{email,password:body.password,data:{name:body.name||'내 계정'}}:{type:'signup',email};
    const r=await upstream(route,{body:payload});if(r.status===429)return json({code:'AUTH_RATE_LIMIT'},429);
    if(r.status<200||r.status>=300){const c=r.data?.error_code||r.data?.code;if(['user_already_exists','email_exists'].includes(c))return json({accepted:true,verificationRequired:true,authenticated:false},202);return json({code:['email_address_invalid','email_address_not_authorized','weak_password'].includes(c)?'SIGNUP_INPUT_REJECTED':'SIGNUP_DELIVERY_UNAVAILABLE'},r.status<500?400:503);}
    return json({accepted:true,verificationRequired:true,authenticated:false},202);
   }
   const r=await upstream('/token?grant_type=password',{body:{email,password:body.password}});
   if(r.status===429)return json({code:'AUTH_RATE_LIMIT'},429);
   if(r.status!==200){const c=r.data?.error_code||r.data?.code;return json({code:c==='email_not_confirmed'?'EMAIL_CONFIRMATION_REQUIRED':'LOGIN_REJECTED'},c==='email_not_confirmed'?403:r.status>=500?503:401);}
   const data=r.data;if(typeof data.access_token!=='string'||data.access_token.length>2800||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0||!UUID.test(data.user?.id||''))return json({code:'AUTH_PROVIDER_RESPONSE_INVALID'},503);
   const now=Math.floor(clock()/1000),t={origin,issuer,uid:data.user.id,access:data.access_token,issued:now,expires:now+Math.min(3600,Math.floor(data.expires_in))};
   const usr=await verified(t);if(!usr)return json({code:'EMAIL_CONFIRMATION_REQUIRED'},403);
   if(normalizeLaunchEmail(usr.email)!==email)return json({code:'AUTH_IDENTITY_MISMATCH'},403);
   const p=principal(usr);return json({success:true,authenticated:true,user:p.user,redirect:'/'},200,[cookie(seal(t),t.expires-now)]);
  }catch{return json({code:'AUTH_SERVICE_UNAVAILABLE'},503);}
 }
 return Object.freeze({authRoutes,sessionVerifier});
}
