import {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {jwtVerify,createRemoteJWKSet} from 'jose';

const STAGE='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1';
const PROD='https://cgrppxfdurpzzfvkmfte.supabase.co/auth/v1';
const TX='__Host-thefa_core_oidc_tx';
const SESSION='__Host-thefa_core_oidc_session';
const CODE=/^[A-Za-z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE={'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const base64=b=>b.toString('base64url');
const sha=s=>base64(createHash('sha256').update(s).digest());
const nonce=()=>base64(randomBytes(32));
const cookie=(n,v,maxAge)=>n+'='+v+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+maxAge;
function config(env){
 try{
  const issuer=env.THEFA_CORE_OIDC_ISSUER,origin=env.THEFA_CORE_OIDC_ORIGIN,clientId=env.THEFA_CORE_OIDC_CLIENT_ID;
  const raw=env.THEFA_CORE_OIDC_COOKIE_SECRET_BASE64URL;
  if(![STAGE,PROD].includes(issuer)||typeof clientId!=='string'||!/^[A-Za-z0-9._:-]{10,256}$/.test(clientId)||
    typeof raw!=='string'||!CODE.test(raw))return null;
  const key=Buffer.from(raw,'base64url');
  if(key.length!==32||base64(key)!==raw)return null;
  const u=new URL(origin);
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/'||
    !['thefacore.com','thefa-core-customer.vercel.app'].includes(u.hostname)&&
    !/^thefa-core-customer-[a-z0-9-]+\.vercel\.app$/.test(u.hostname))return null;
  // Only the staging issuer can be used with a preview deployment.
  if(u.hostname!=='thefacore.com'&&issuer!==STAGE)return null;
  return Object.freeze({issuer,origin:u.origin,clientId,key});
 }catch{return null;}
}
function seal(obj,key){
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);
 const out=Buffer.concat([c.update(JSON.stringify(obj)),c.final()]);
 return base64(Buffer.concat([iv,c.getAuthTag(),out]));
}
function open(raw,key){
 if(typeof raw!=='string'||raw.length>5000||!/^[A-Za-z0-9_-]+$/.test(raw))return null;
 try{const b=Buffer.from(raw,'base64url');if(b.length<29)return null;
  const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));
  const obj=JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8'));
  return obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:null;
 }catch{return null;}
}
function pickCookie(header,name){
 if(typeof header!=='string'||header.length>8192)return null;
 let found=null;
 for(const item of header.split(';')){
  const pos=item.indexOf('=');
  if(pos<1||item.slice(0,pos).trim()!==name)continue;
  if(found!==null)return null;
  found=item.slice(pos+1).trim();
 }
 return found;
}
function same(a,b){
 if(!CODE.test(a||'')||!CODE.test(b||''))return false;
 return timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
function http(res,code,body,cookies=[]){
 res.statusCode=code;
 for(const[k,v]of Object.entries({...NO_STORE,'content-type':'application/json; charset=utf-8'}))res.setHeader(k,v);
 if(cookies.length)res.setHeader('set-cookie',cookies);
 res.end(JSON.stringify(body));
}
function location(res,url,cookies=[]){
 res.statusCode=303;
 for(const[k,v]of Object.entries(NO_STORE))res.setHeader(k,v);
 res.setHeader('location',url);
 if(cookies.length)res.setHeader('set-cookie',cookies);
 res.end('');
}
function validRequest(req,cfg){
 if(typeof req?.url!=='string'||req.url.length>8192)return null;
 const host=new URL(cfg.origin).host;
 const h=req.headers||{};
 // Vercel sends an RFC 7239 Forwarded header on legitimate requests.
 // It is untrusted input and NEVER used for origin, authority, or identity.
 // Only the canonical Host and matching HTTPS proxy headers are considered.
 if(h.host!==host||
   (h['x-forwarded-host']&&h['x-forwarded-host']!==host)||
   (h['x-forwarded-proto']&&h['x-forwarded-proto']!=='https')||
   h['x-original-url'])return null;
 try{const url=new URL(req.url,cfg.origin);return url.origin===cfg.origin&&!url.hash?url:null;}catch{return null;}
}
function session(req,cfg,now){
 const ticket=open(pickCookie(req.headers.cookie,SESSION),cfg.key);
 if(ticket?.issuer!==cfg.issuer||ticket?.audience!==cfg.clientId||ticket.origin!==cfg.origin||
    !UUID.test(ticket.sub??'')||!Number.isSafeInteger(ticket.issued)||!Number.isSafeInteger(ticket.expires)||
    ticket.issued>now+30||ticket.expires<=now||ticket.expires-now>1800)return null;
 return ticket;
}
const jwks=new Map();
const tokenKeys=issuer=>{
 if(!jwks.has(issuer))jwks.set(issuer,createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{timeoutDuration:6000,cacheMaxAge:300000}));
 return jwks.get(issuer);
};
export function createThefaCoreOidcHandler({env=process.env,clock=Date.now,fetchImpl=globalThis.fetch,verifyJwt}={}){
 return async function handle(req,res,operation){
  const cfg=config(env);
  if(!cfg)return http(res,503,{code:'THEFA_CORE_OIDC_NOT_CONFIGURED'});
  const url=validRequest(req,cfg);
  if(!url)return http(res,403,{code:'THEFA_CORE_OIDC_INVALID_ORIGIN'});
  const now=Math.floor(clock()/1000);
  if(operation==='status'){
   if(req.method!=='GET'||url.search)return http(res,405,{code:'METHOD_OR_QUERY_INVALID'});
   const s=session(req,cfg,now);
   return http(res,200,{configured:true,authenticated:!!s,accountLinked:false,canUseAi:false,issuer:cfg.issuer});
  }
  if(operation==='session'){
   if(req.method!=='GET'||url.search)return http(res,405,{code:'METHOD_OR_QUERY_INVALID'});
   const s=session(req,cfg,now);
   return http(res,200,{authenticated:!!s,accountLinked:false,canUseAi:false,expiresInSeconds:s?s.expires-now:0});
  }
  if(operation==='logout'){
   if(req.method!=='POST'||url.search||req.headers.origin!==cfg.origin||
     (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])))
      return http(res,403,{code:'THEFA_CORE_OIDC_LOGOUT_ORIGIN_INVALID'});
   return http(res,200,{success:true,scope:'CORE_LOCAL_ONLY'},[cookie(TX,'',0),cookie(SESSION,'',0)]);
  }
  if(req.method!=='GET')return http(res,405,{code:'METHOD_NOT_ALLOWED'});
  if(operation==='start'){
   if(url.search)return http(res,400,{code:'INVALID_OIDC_QUERY'});
   const state=nonce(),verifier=nonce(),oidcNonce=nonce();
   const target=new URL(cfg.issuer+'/oauth/authorize');
   for(const[k,v]of Object.entries({response_type:'code',client_id:cfg.clientId,redirect_uri:cfg.origin+'/api/oidc/callback',
    scope:'openid email profile',state,nonce:oidcNonce,code_challenge:sha(verifier),code_challenge_method:'S256'}))target.searchParams.set(k,v);
   const tx=seal({state,verifier,oidcNonce,at:now,origin:cfg.origin},cfg.key);
   return location(res,target.href,[cookie(TX,tx,300)]);
  }
  if(operation!=='callback')return http(res,404,{code:'NOT_FOUND'});
  const clear=[cookie(TX,'',0)];
  const keys=[...url.searchParams.keys()];
  if(keys.some(k=>!['state','code','iss'].includes(k))||
    url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||
    url.searchParams.has('iss')&&url.searchParams.get('iss')!==cfg.issuer)
   return http(res,403,{code:'THEFA_CORE_OIDC_CALLBACK_INVALID'},clear);
  const tx=open(pickCookie(req.headers.cookie,TX),cfg.key),state=url.searchParams.get('state');
  const code=url.searchParams.get('code');
  if(!tx||tx.origin!==cfg.origin||!Number.isSafeInteger(tx.at)||now-tx.at<0||now-tx.at>300||
    !same(tx.state,state)||!CODE.test(tx.verifier)||!CODE.test(tx.oidcNonce)||
    typeof code!=='string'||code.length<1||code.length>4096)
    return http(res,403,{code:'THEFA_CORE_OIDC_TRANSACTION_INVALID'},clear);
  try{
   const form=new URLSearchParams({grant_type:'authorization_code',client_id:cfg.clientId,redirect_uri:cfg.origin+'/api/oidc/callback',code,code_verifier:tx.verifier});
   const answer=await fetchImpl(cfg.issuer+'/oauth/token',{method:'POST',redirect:'error',
     headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:form,signal:AbortSignal.timeout(10000)});
   if(!answer.ok)return http(res,403,{code:'THEFA_CORE_OIDC_CODE_EXCHANGE_FAILED'},clear);
   const token=await answer.json();
   if(typeof token?.id_token!=='string'||token.id_token.length>15000||typeof token?.access_token!=='string'||
     token.token_type?.toLowerCase()!=='bearer')return http(res,403,{code:'THEFA_CORE_OIDC_TOKEN_INVALID'},clear);
   const {payload}=verifyJwt?await verifyJwt(token.id_token,{issuer:cfg.issuer,audience:cfg.clientId}):
     await jwtVerify(token.id_token,tokenKeys(cfg.issuer),{issuer:cfg.issuer,audience:cfg.clientId,algorithms:['ES256'],clockTolerance:'30s'});
   if(!UUID.test(payload.sub??'')||payload.nonce!==tx.oidcNonce||
     payload.azp!=null&&payload.azp!==cfg.clientId||!Number.isSafeInteger(payload.exp)||
     payload.exp<=now||payload.exp>now+3600)
      return http(res,403,{code:'THEFA_CORE_OIDC_ID_TOKEN_INVALID'},clear);
   // Only the shared identity is asserted. Existing customer allowance/account
   // admission is intentionally NOT bypassed by an ID token.
   const expires=Math.min(payload.exp,now+1800);
   const ticket=seal({issuer:cfg.issuer,audience:cfg.clientId,origin:cfg.origin,sub:payload.sub,issued:now,expires},cfg.key);
   return location(res,cfg.origin+'/login?oidc=verified',[...clear,cookie(SESSION,ticket,Math.min(1800,expires-now))]);
  }catch{return http(res,503,{code:'THEFA_CORE_OIDC_VERIFICATION_UNAVAILABLE'},clear);}
 };
}
