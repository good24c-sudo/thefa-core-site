// Verify a Core OAuth JWT with a staging-only Supabase Edge function.
// The Edge gateway requires JWT validation, then Supabase Auth /user verifies
// the same user and exact OAuth client. No private key or service_role transfer.
const EDGE_URL='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/thefa-core-customer-sso-stage';
const ISSUER='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1';
const CLIENT_ID='6b70d657-b1fa-4174-a3f2-29d475f4e3c0';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]{2,1200}\.[A-Za-z0-9_-]{20,2600}\.[A-Za-z0-9_-]{20,1600}$/;
const fail=()=>Object.assign(new Error('THEFA_CORE_STAGE_AUTH_VERIFICATION_UNAVAILABLE'),{code:'THEFA_CORE_STAGE_AUTH_VERIFICATION_UNAVAILABLE'});
export async function verifyStageEdgeOidcIdentity({issuer,audience,subject,accessToken}={},{
 env=process.env,fetchImpl=globalThis.fetch
}={}){
 if(env.VERCEL_ENV!=='preview'||env.THEFA_CORE_STAGE_EDGE_AUTH_READY!=='true'||
    env.THEFA_CORE_OIDC_ISSUER!==ISSUER||issuer!==ISSUER||audience!==CLIENT_ID||
    env.THEFA_CORE_OIDC_CLIENT_ID!==CLIENT_ID||!UUID.test(subject??'')||
    typeof accessToken!=='string'||accessToken.length>4096||!JWT.test(accessToken)||
    typeof fetchImpl!=='function')throw fail();
 let res;
 try{
  res=await fetchImpl(EDGE_URL,{method:'GET',redirect:'error',
   headers:{authorization:'Bearer '+accessToken,accept:'application/json'},
   signal:AbortSignal.timeout(9000)
  });
 }catch{throw fail()}
 if(!res?.ok)return Promise.reject(fail());
 let body;
 try{
  const len=Number(res.headers.get('content-length')||'0');
  if(len>8192)throw Error('BODY_TOO_LARGE');
  const content=await res.text();
  if(content.length>8192)throw Error('BODY_TOO_LARGE');
  body=JSON.parse(content);
 }catch{throw fail()}
 if(body?.contract!=='THEFA_CORE_VERIFIED_OAUTH_IDENTITY_STAGE_V1'||
    body.authenticated!==true||body.issuer!==ISSUER||body.clientId!==CLIENT_ID||
    body.subject!==subject||body.accountLinked!==false||body.canUseAi!==false||
    body.scope!=='IDENTITY_ONLY')throw fail();
 return Object.freeze({sessionVerified:true,subject,accountLinked:false,canUseAi:false});
}
