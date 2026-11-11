// THE FA customer SSO staging bridge: user JWT introspection only.
// NO service_role, no customer writes, no tenant entitlement, no AI usage.
// Deploy exclusively to FA_STAGING with verify_jwt:true.
export const IDP_URL='https://furfjhymxqsbhvuyeqpx.supabase.co';
export const CLIENT_ID='6b70d657-b1fa-4174-a3f2-29d475f4e3c0';
export const ISSUER=IDP_URL+'/auth/v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]{2,1200}\.[A-Za-z0-9_-]{20,2600}\.[A-Za-z0-9_-]{20,1600}$/;
// Supabase now supplies either a public sb_publishable_ key or a legacy anon JWT.
const publicAuthKey=(value)=>typeof value==='string'&&(
 /^sb_publishable_[A-Za-z0-9_-]{24,}$/.test(value)||
 /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value));
const ALLOWED_PATHS=new Set(['/','/thefa-core-customer-sso-stage','/functions/v1/thefa-core-customer-sso-stage']);
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Authorization'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
function parseJwtPayload(jwt){
 try{
  if(!JWT.test(jwt))return null;
  const tokenBody=jwt.split('.')[1];
  const decoded=JSON.parse(atob(tokenBody.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-tokenBody.length%4)%4)));
  return decoded&&typeof decoded==='object'&&!Array.isArray(decoded)?decoded:null;
 }catch{return null}
}
function safeClaims(p,now){
 return p&&p.iss===ISSUER&&p.client_id===CLIENT_ID&&p.role==='authenticated'&&
  (p.aud==='authenticated'||Array.isArray(p.aud)&&p.aud.length===1&&p.aud[0]==='authenticated')&&
  UUID.test(p.sub??'')&&UUID.test(p.session_id??'')&&
  Number.isSafeInteger(p.iat)&&p.iat<=now+60&&p.iat>now-86400&&
  Number.isSafeInteger(p.exp)&&p.exp>now&&p.exp<=now+86400;
}
export function createStageCustomerAuthProbe({env,fetcher=fetch,now=Date.now}={}){
 return async function handle(request){
  const projectUrl=env?.SUPABASE_URL,publicKey=env?.SUPABASE_ANON_KEY;
  if(projectUrl!==IDP_URL||!publicAuthKey(publicKey)||typeof fetcher!=='function'){
   // Emit only non-sensitive booleans. Never log the key or incoming JWT.
   console.warn(JSON.stringify({event:'THEFA_CORE_STAGE_PUBLIC_IDP_CONFIG_GAP',
    idpUrlMatches:projectUrl===IDP_URL,publicKeyPresent:typeof publicKey==='string',
    publicKeyFormatAccepted:publicAuthKey(publicKey),
    fetchAvailable:typeof fetcher==='function'}));
   return reply(503,{code:'THEFA_STAGE_IDP_RUNTIME_MISMATCH'});
  }
  let url;
  try{url=new URL(request.url)}catch{return reply(400,{code:'REQUEST_INVALID'})}
  if(url.origin!==IDP_URL||!ALLOWED_PATHS.has(url.pathname)||url.search||url.hash)
   return reply(404,{code:'THEFA_STAGE_SSO_ROUTE_NOT_FOUND'});
  if(request.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  if(request.headers.has('origin'))return reply(403,{code:'BROWSER_DIRECT_ACCESS_DENIED'});
  const header=request.headers.get('authorization')||'';
  if(!header.startsWith('Bearer ')||header.length>4100||!JWT.test(header.slice(7)))
   return reply(401,{code:'CORE_OAUTH_ACCESS_TOKEN_REQUIRED'});
  const token=header.slice(7),claims=parseJwtPayload(token),epoch=Math.floor(now()/1000);
  // The platform's verify_jwt MUST remain enabled. Supabase Auth /user is
  // an independent live verification and session/user existence check.
  if(!safeClaims(claims,epoch))return reply(403,{code:'THEFA_SSO_CLIENT_SCOPE_DENIED'});
  let result;
  try{
   result=await fetcher(ISSUER+'/user',{
    method:'GET',redirect:'error',
    headers:{apikey:publicKey,authorization:'Bearer '+token,accept:'application/json'},
    signal:AbortSignal.timeout(8000)
   });
  }catch{return reply(503,{code:'STAGING_AUTH_VERIFICATION_UNAVAILABLE'})}
  if(result.status===401||result.status===403)return reply(401,{code:'STAGING_AUTH_SESSION_REJECTED'});
  if(!result.ok)return reply(503,{code:'STAGING_AUTH_SERVICE_UNAVAILABLE'});
  let user;
  try{user=await result.json()}catch{return reply(503,{code:'STAGING_AUTH_USER_INVALID'})}
  if(!user||user.id!==claims.sub||user.is_anonymous===true||
     user.aud&&user.aud!=='authenticated'||user.deleted_at)
   return reply(403,{code:'STAGING_AUTH_IDENTITY_INCONSISTENT'});
  // These fields are identity assertions, not customer authorization/allowance.
  return reply(200,{contract:'THEFA_CORE_VERIFIED_OAUTH_IDENTITY_STAGE_V1',
   authenticated:true,issuer:ISSUER,clientId:CLIENT_ID,subject:claims.sub,
   accountLinked:false,canUseAi:false,scope:'IDENTITY_ONLY'});
 };
}
