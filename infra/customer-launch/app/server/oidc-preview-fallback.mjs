import {readCoreOidcIdentity} from './thefa-oidc-client.mjs';
const ORIGIN_PATTERN=/^https:\/\/thefa-core-customer-[a-z0-9-]+\.vercel\.app$/;
const LEGACY_ISSUER='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const routes=new Set(['/api/auth/providers','/api/auth/session','/auth/start','/auth/logout','/auth/complete','/auth/email/send','/auth/email/verify']);
function send(res,status,data,cookies=[]){
 res.statusCode=status;
 res.setHeader('content-type','application/json; charset=utf-8');
 res.setHeader('cache-control','private, no-store');
 res.setHeader('x-content-type-options','nosniff');
 res.setHeader('vary','Cookie');
 if(cookies.length)res.setHeader('set-cookie',cookies);
 res.end(JSON.stringify(data));
}
export default async function oidcPreviewFallback(req,res){
 const origin=process.env.THEFA_CORE_OIDC_ORIGIN;
 if(process.env.VERCEL_ENV!=='preview'||process.env.THEFA_CORE_OIDC_ISSUER!=='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1'||
   !ORIGIN_PATTERN.test(origin||''))return send(res,503,{code:'UNIFIED_PREVIEW_NOT_CONFIGURED'});
 let url;
 try{url=new URL(req.url,origin)}catch{return send(res,400,{code:'REQUEST_INVALID'})}
 const path=url.pathname,host=new URL(origin).host,h=req.headers||{};
 if(url.origin!==origin||url.search||url.hash||
   h.host!==host||(h['x-forwarded-host']&&h['x-forwarded-host']!==host)||
   (h['x-forwarded-proto']&&h['x-forwarded-proto']!=='https')||
   h['x-original-url']||
   (h['sec-fetch-site']&&!['same-origin','none'].includes(h['sec-fetch-site'])))
   return send(res,403,{code:'UNIFIED_PREVIEW_ORIGIN_INVALID'});
 if(!routes.has(path)&&!path.startsWith('/api/customer/'))return send(res,404,{code:'NOT_FOUND'});
 if(path==='/api/auth/providers'){
  if(req.method!=='GET')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
  return send(res,200,{issuer:LEGACY_ISSUER,providers:[
   {id:'google',enabled:false,callback:LEGACY_ISSUER+'/callback/google'},
   {id:'kakao',enabled:false,callback:LEGACY_ISSUER+'/callback/kakao'}],
   email:{enabled:false},unified:{enabled:true,issuer:process.env.THEFA_CORE_OIDC_ISSUER}});
 }
 if(path==='/auth/logout'){
  if(req.method!=='POST'||h.origin!==origin||!/^application\/json(?:\s*;|$)/i.test(h['content-type']||''))
   return send(res,403,{code:'UNIFIED_LOGOUT_CSRF_INVALID'});
  return send(res,200,{success:true,scope:'CORE_LOCAL_ONLY'},[
   '__Host-thefa_core_oidc_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
   '__Host-thefa_core_oidc_tx=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
 }
 if(req.method!=='GET'&&req.method!=='POST')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
 let identity=null;
 try{identity=readCoreOidcIdentity(h.cookie||'')}catch{}
 if(path==='/api/auth/session'){
  if(req.method!=='GET')return send(res,405,{code:'METHOD_NOT_ALLOWED'});
  return send(res,200,{authenticated:false,ssoAuthenticated:!!identity,accountLinked:false,user:null});
 }
 if(path.startsWith('/api/customer/'))
  return identity?send(res,409,{code:'CORE_ACCOUNT_LINK_REQUIRED',ssoAuthenticated:true}):
    send(res,401,{code:'AUTH_REQUIRED'});
 return send(res,503,{code:'USE_THEFA_UNIFIED_ID_LOGIN'});
}
