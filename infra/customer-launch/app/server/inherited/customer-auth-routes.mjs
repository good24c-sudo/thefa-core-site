import {normalizeLaunchEmail} from '../fresh-launch-accounts.mjs';
import {validateCustomerOrigin} from './customer-origin-policy.mjs';

// Isolated composition of the existing two auth services; no OAuth/session engine lives here.
const AUTH_PATH='/functions/v1/core-customer-auth';
const PROVIDERS=Object.freeze({google:{label:'Google',origin:'https://accounts.google.com',path:'/o/oauth2/v2/auth'},kakao:{label:'카카오',origin:'https://kauth.kakao.com',path:'/oauth/authorize'}});
const fail=(status,code)=>Response.json({code},{status,headers:baseHeaders()});
class AuthRouteError extends Error { constructor(status,code){super(code);this.status=status;this.code=code;} }
const problem=(status,code)=>new AuthRouteError(status,code);
const upstreamInvalid=()=>{throw problem(502,'CUSTOMER_AUTH_UPSTREAM_INVALID');};
function baseHeaders(){return new Headers({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});}
function trustedIssuer(issuer){
 if(typeof issuer!=='string'||!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/core-customer-auth$/.test(issuer))throw Error('CUSTOMER_AUTH_CONFIGURATION_INVALID');
 return issuer;
}
function safeHeaders(request,origin){
 // Do not forward browser-supplied issuer, binding, account-flow or authority headers.
 const headers=new Headers({origin});
 for(const name of ['cookie','user-agent','accept'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
 return headers;
}
function checkCookiesIn(headers){
 const text=headers.get('cookie');if(text===null)return;
 const names=new Set();
 for(const part of text.split(';')){
  const pair=part.trim(),match=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\x00-\x20\x7f;,]*)$/.exec(pair);
  if(!match||names.has(match[1]))throw problem(400,'CUSTOMER_AUTH_COOKIE_INVALID');
  names.add(match[1]);
 }
}
function outputCookies(response,{required=false}={}){
 if(!(response instanceof Response)||typeof response.headers.getSetCookie!=='function')upstreamInvalid();
 const cookies=response.headers.getSetCookie();if(required&&!cookies.length)upstreamInvalid();
 if(cookies.length>16)upstreamInvalid();
 const names=new Map(),clean=[];
 for(const cookie of cookies){
  if(cookie.length>8192||/[\r\n\x00]/.test(cookie))upstreamInvalid();
  const [pair,...attributes]=cookie.split(';').map(x=>x.trim());
  const match=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\s;,]*)$/.exec(pair);
  if(!match)upstreamInvalid();
  const attrs=new Map();
  for(const attr of attributes){const index=attr.indexOf('='),name=(index<0?attr:attr.slice(0,index)).toLowerCase(),value=index<0?'':attr.slice(index+1);if(!name||attrs.has(name))upstreamInvalid();attrs.set(name,value);}
  if(attrs.has('domain')||!attrs.has('secure')||attrs.get('secure')!==''||!attrs.has('httponly')||attrs.get('httponly')!==''||
   !['lax','strict'].includes(attrs.get('samesite')?.toLowerCase())||!['/',AUTH_PATH].includes(attrs.get('path')))upstreamInvalid();
  // The pinned engine emits the same empty account_data deletion twice on logout.
  // Only a byte-identical, already validated deletion may collapse; conflicting
  // duplicate cookies and duplicate nonempty credentials remain rejected.
  if(names.has(match[1])){
   if(names.get(match[1])!==cookie||match[2]!==''||attrs.get('max-age')!=='0')upstreamInvalid();
   continue;
  }
  names.set(match[1],cookie);clean.push(cookie);
 }
 return clean;
}
function replyJson(body,cookies=[]){const headers=baseHeaders();for(const cookie of cookies)headers.append('set-cookie',cookie);return Response.json(body,{headers});}
function redirect(location,status,cookies=[]){const headers=baseHeaders();headers.set('location',location);for(const cookie of cookies)headers.append('set-cookie',cookie);return new Response(null,{status,headers});}
async function boundedText(message,limit){
 const length=message.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw problem(413,'CUSTOMER_AUTH_BODY_TOO_LARGE');
 if(!message.body)return '';
 const reader=message.body.getReader(),chunks=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw problem(413,'CUSTOMER_AUTH_BODY_TOO_LARGE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const joined=new Uint8Array(total);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(joined);}catch{throw problem(400,'CUSTOMER_AUTH_JSON_INVALID');}
}
async function upstreamJson(response){
 if(!(response instanceof Response)||response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))upstreamInvalid();
 try{return JSON.parse(await boundedText(response,32768));}catch{upstreamInvalid();}
}
function destination(provider,raw,issuer){
 if(typeof raw!=='string'||raw.length>5000||raw.trim()!==raw||/[\r\n\\]/.test(raw))upstreamInvalid();
 let url;try{url=new URL(raw);}catch{upstreamInvalid();}
 const allow=PROVIDERS[provider];
 if(url.protocol!=='https:'||url.origin!==allow.origin||url.pathname!==allow.path||url.username||url.password||url.hash)upstreamInvalid();
 const params=url.searchParams,seen=new Set();
 for(const key of params.keys()){if(seen.has(key))upstreamInvalid();seen.add(key);}
 for(const key of ['redirect_uri','state','client_id'])if(!params.get(key))upstreamInvalid();
 if(params.get('redirect_uri')!==issuer+'/callback/'+provider||!/^[A-Za-z0-9_.~-]{16,4096}$/.test(params.get('state'))||
  (params.has('provider')&&params.get('provider')!==provider)||
  (params.has('issuer')&&params.get('issuer')!==issuer))upstreamInvalid();
 return url.href;
}
function sessionValid(value){
 const session=value?.session,user=value?.user;
 const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x20\x7f]/.test(v);
 if(!id(session?.id)||!id(session?.userId)||!id(user?.id)||session.userId!==user.id)return false;
 const expires=session.expiresAt instanceof Date?session.expiresAt.getTime():typeof session.expiresAt==='string'?Date.parse(session.expiresAt):NaN;
 return Number.isFinite(expires)&&expires>Date.now();
}
export function createCustomerAuthRoutes({authService,providerService,customerOrigin,environment,issuer,accountAuth,resolveLoginContext,launchAccounts}={}){
 let origin,ready=false;
 try{
  if(typeof customerOrigin!=='string'||typeof environment!=='string')throw Error('EXPLICIT_CUSTOMER_ORIGIN_REQUIRED');
  origin=validateCustomerOrigin({customerOrigin,environment});trustedIssuer(issuer);
  ready=authService?.baseUrl===origin+AUTH_PATH&&typeof authService.start==='function'&&typeof authService.fetch==='function'&&
   typeof authService.auth?.api?.getSession==='function'&&typeof authService.auth?.api?.signOut==='function'&&
   (launchAccounts===undefined||(['resolve','limit'].every(name=>typeof launchAccounts?.[name]==='function')&&typeof resolveLoginContext==='function'))&&
   (accountAuth===undefined||(['start','finish','session','logout'].every(name=>typeof accountAuth?.[name]==='function')&&typeof resolveLoginContext==='function'));
 }catch{}
 return async request=>{
  try{
   if(!ready)return fail(503,'CUSTOMER_AUTH_RUNTIME_NOT_CONNECTED');
   if(!(request instanceof Request))throw problem(400,'CUSTOMER_AUTH_REQUEST_INVALID');
   const url=new URL(request.url),headers=request.headers;
   if(request.url.length>8192)throw problem(414,'CUSTOMER_AUTH_URL_TOO_LARGE');
   if(url.origin!==origin||url.username||url.password||url.hash||
    (headers.has('host')&&headers.get('host')!==new URL(origin).host)||
    (headers.has('x-forwarded-host')&&headers.get('x-forwarded-host')!==new URL(origin).host)||
    (headers.has('x-forwarded-proto')&&headers.get('x-forwarded-proto')!=='https')||headers.has('forwarded')||headers.has('x-original-url'))throw problem(403,'CUSTOMER_AUTH_ORIGIN_INVALID');
   let headerBytes=0;for(const [key,value]of headers)headerBytes+=new TextEncoder().encode(key+value).length;
   if(headerBytes>8192)throw problem(431,'CUSTOMER_AUTH_HEADERS_TOO_LARGE');
   checkCookiesIn(headers);
   const proxy=/^\/functions\/v1\/core-customer-auth\/callback\/(google|kakao)\/oauth-proxy$/.exec(url.pathname);
    if(proxy&&proxy[1]==='kakao')return fail(503,'LOGIN_PROVIDER_NOT_READY');
   const methods={'/api/auth/providers':'GET','/api/auth/session':'GET','/auth/start':'POST','/auth/logout':'POST','/auth/complete':'GET','/auth/email/send':'POST','/auth/email/verify':'POST'};
   const method=proxy?'GET':methods[url.pathname];
   if(!method)return fail(404,'NOT_FOUND');
   if(request.method!==method)return fail(405,'METHOD_NOT_ALLOWED');
   if(!proxy&&url.search)throw problem(400,'CUSTOMER_AUTH_QUERY_INVALID');
   if(headers.has('content-encoding')&&headers.get('content-encoding')!=='identity')throw problem(415,'CUSTOMER_AUTH_ENCODING_INVALID');
   if(method==='POST'){
    if(headers.get('origin')!==origin||(headers.has('sec-fetch-site')&&!['same-origin','none'].includes(headers.get('sec-fetch-site'))))throw problem(403,'CUSTOMER_AUTH_CSRF_INVALID');
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers.get('content-type')??''))throw problem(415,'CUSTOMER_AUTH_JSON_REQUIRED');
   }
   const trustedHeaders=safeHeaders(request,origin);
   if(url.pathname.startsWith('/auth/email/')){
    if(!launchAccounts||typeof authService.auth.api.sendVerificationOTP!=='function'||typeof authService.auth.api.signInEmailOTP!=='function')return fail(503,'EMAIL_LOGIN_NOT_CONFIGURED');
    const verify=url.pathname==='/auth/email/verify';let body,email;
    try{body=JSON.parse(await boundedText(request,1024));email=normalizeLaunchEmail(body?.email);
     const fields=Object.keys(body);if(fields.length!==(verify?2:1)||fields.some(k=>!['email',...(verify?['otp']:[])].includes(k))||verify&&!/^\d{6}$/.test(body.otp??''))throw Error();
    }catch{throw problem(400,'EMAIL_PAYLOAD_INVALID');}
    const context=await resolveLoginContext(request);await launchAccounts.limit({email,peer:context?.peer,operation:verify?'verify':'send'});
    if(!verify){await authService.sendEmailCode({headers:trustedHeaders,email});return replyJson({success:true,expiresIn:300});}
    let result;try{result=await authService.auth.api.signInEmailOTP({headers:trustedHeaders,body:{email,otp:body.otp},asResponse:true});}catch{throw problem(400,'EMAIL_CODE_INVALID_OR_EXPIRED');}
    if(!(result instanceof Response)||result.status!==200)throw problem(400,'EMAIL_CODE_INVALID_OR_EXPIRED');
    const issued=outputCookies(result,{required:true}),pairs=new Map();
    for(const part of (trustedHeaders.get('cookie')??'').split(';')){const at=part.indexOf('=');if(at>0)pairs.set(part.slice(0,at).trim(),part.slice(at+1).trim());}
    for(const part of issued){const pair=part.split(';')[0],at=pair.indexOf('=');pairs.set(pair.slice(0,at),pair.slice(at+1));}
    const current=await launchAccounts.resolve([...pairs].map(([k,v])=>k+'='+v).join('; '),{admit:true});
    if(!current)throw problem(401,'EMAIL_SESSION_REQUIRED');
    return replyJson({success:true,authenticated:true,redirect:'/'},issued);
   }
   if(url.pathname==='/api/auth/session'){
    if(request.body!==null||headers.has('transfer-encoding')||(headers.has('content-length')&&headers.get('content-length')!=='0'))throw problem(400,'CUSTOMER_AUTH_GET_BODY_INVALID');
    if(launchAccounts){const value=await launchAccounts.resolve(trustedHeaders.get('cookie')??'');return replyJson({authenticated:Boolean(value),user:value?.user??null});}
    if(accountAuth){
     let value;try{value=await accountAuth.session(trustedHeaders.get('cookie')??'')}catch(error){if(error?.status!==401)throw error;}
     if(!value)return replyJson({authenticated:false,user:null});
     return replyJson({authenticated:true,user:{id:value.user.id,displayName:value.user.displayName,provider:value.user.provider}});
    }
    const value=await authService.auth.api.getSession({headers:trustedHeaders});
    if(!sessionValid(value))return replyJson({authenticated:false,user:null});
    const name=value.user.name;
    const displayName=typeof name==='string'&&name.length<=160&&name.trim()&&!/[\x00-\x1f\x7f-\x9f]/.test(name)?name.trim():'내 계정';
    return replyJson({authenticated:true,user:{id:value.user.id,displayName}});
   }
   if(url.pathname==='/api/auth/providers'){
    if(providerService?.baseUrl!==issuer||typeof providerService.fetch!=='function')return fail(503,'CUSTOMER_AUTH_RUNTIME_NOT_CONNECTED');
    const response=await providerService.fetch(new Request(issuer+'/customer/providers',{headers:{accept:'application/json'}}));
    const data=await upstreamJson(response);
    if(data?.issuer!==issuer||!Array.isArray(data.providers)||data.providers.length!==2)upstreamInvalid();
    const catalog=new Map();
    for(const provider of data.providers){if(!Object.hasOwn(PROVIDERS,provider?.id)||typeof provider.enabled!=='boolean'||catalog.has(provider.id))upstreamInvalid();catalog.set(provider.id,provider.enabled);}
    return replyJson({issuer,email:{enabled:Boolean(launchAccounts&&typeof authService.auth.api.sendVerificationOTP==='function')},providers:Object.entries(PROVIDERS).map(([id,value])=>({id,label:value.label,enabled:catalog.get(id),callback:issuer+'/callback/'+id}))});
   }
   if(url.pathname==='/auth/start'){
    const body=await boundedText(request,1024),match=/^\s*\{\s*"provider"\s*:\s*"(google|kakao)"\s*\}\s*$/.exec(body);
    if(!match)throw problem(400,'CUSTOMER_AUTH_PAYLOAD_INVALID');
    if(match[1]!=='google')return fail(503,'LOGIN_PROVIDER_NOT_READY');
    if(accountAuth){
     const context=await resolveLoginContext(request);
     if(!context||typeof context.peer!=='string'||context.peer.length<1||context.peer.length>100||
       ![null,undefined].includes(context.guestEmail)&&typeof context.guestEmail!=='string')throw problem(503,'CUSTOMER_LOGIN_CONTEXT_REQUIRED');
     const started=await accountAuth.start({provider:match[1],guestEmail:context.guestEmail??null,peer:context.peer,headers:trustedHeaders});
     const response=new Response(null,{headers:baseHeaders()});
     for(const value of [...(started.cookies??[]),started.cookie])response.headers.append('set-cookie',value);
     const location=destination(match[1],started.location,issuer);return replyJson({location},outputCookies(response,{required:true}));
    }
    const response=await authService.start({provider:match[1],headers:trustedHeaders});
    const cookies=outputCookies(response,{required:true}),data=await upstreamJson(response);
    const location=destination(match[1],data?.url,issuer);
    // The existing OAuth proxy updates the JSON URL; discard its unused upstream Location.
    return replyJson({location},cookies);
   }
   if(url.pathname==='/auth/logout'){
    const body=await boundedText(request,1024);if(!/^\s*\{\s*\}\s*$/.test(body))throw problem(400,'CUSTOMER_AUTH_PAYLOAD_INVALID');
    const accountCookie=accountAuth?await accountAuth.logout(trustedHeaders.get('cookie')??''):null;
    const response=await authService.auth.api.signOut({headers:trustedHeaders,asResponse:true});
    if(!(response instanceof Response)||response.status!==200||response.headers.has('location'))upstreamInvalid();
    const cookies=outputCookies(response),data=await upstreamJson(response);if(data?.success!==true)upstreamInvalid();
    return replyJson({success:true},[...cookies,...(accountCookie?[accountCookie]:[])]);
   }
   if(url.pathname==='/auth/complete'){
    if(launchAccounts&&!await launchAccounts.resolve(trustedHeaders.get('cookie')??'',{admit:true}))throw problem(401,'CUSTOMER_AUTH_SESSION_REQUIRED');
    if(accountAuth){
     const result=await accountAuth.finish({cookie:trustedHeaders.get('cookie')??''}),response=new Response(null,{headers:baseHeaders()});
     for(const value of [result.cookie,result.clearFlowCookie])response.headers.append('set-cookie',value);
     return redirect(origin+'/',303,outputCookies(response,{required:true}));
    }
    const value=await authService.auth.api.getSession({headers:trustedHeaders});
    if(!sessionValid(value))return fail(401,'CUSTOMER_AUTH_SESSION_REQUIRED');
    return redirect(origin+'/',303);
   }
   if(proxy){
    // The existing engine verifies OAuth state/binding. Only its exact HTTPS callback proxy is reachable.
    const keys=new Set();for(const key of url.searchParams.keys()){if(keys.has(key))throw problem(400,'CUSTOMER_AUTH_QUERY_INVALID');keys.add(key);}
    const response=await authService.fetch(new Request(origin+url.pathname+url.search,{headers:trustedHeaders}));
    if(!(response instanceof Response)||![302,303].includes(response.status))upstreamInvalid();
    const location=response.headers.get('location');
    if(![origin+'/auth/complete',origin+'/login#login-failed'].includes(location))upstreamInvalid();
    return redirect(location,response.status,outputCookies(response,{required:location===origin+'/auth/complete'}));
   }
   return fail(404,'NOT_FOUND');
  }catch(error){if(launchAccounts&&error?.status===429)return fail(429,'EMAIL_RATE_LIMIT');return error instanceof AuthRouteError?fail(error.status,error.code):
    accountAuth&&error?.status===401?fail(401,'CUSTOMER_ACCOUNT_SESSION_REQUIRED'):fail(503,'CUSTOMER_AUTH_UNAVAILABLE');}
 };
}


