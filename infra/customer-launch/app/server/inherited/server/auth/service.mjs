import {betterAuth} from 'better-auth';
import {oAuthProxy,emailOTP} from 'better-auth/plugins';
import {randomUUID,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {addOAuthServerContext,getOAuthState,createAuthMiddleware,APIError} from 'better-auth/api';
import {Buffer} from 'node:buffer';
import {AsyncLocalStorage} from 'node:async_hooks';
import {configuredAuthBinding} from './configuration.mjs';
import {getConfiguredCoreAuthPoolBinding} from './database.mjs';

const bindings=new WeakMap();
export const getConfiguredCustomerAuthBinding=service=>bindings.get(service)??null;
const PROVIDERS={google:'Google',kakao:'카카오'};
const BINDING_COOKIE='thefa_core_auth_binding';
const fail=(status,code)=>Response.json({code},{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});

export async function createConfiguredCustomerAuthService({environment,customerOrigin,issuer,
  secret,proxySecret,database,memory=false,mode,google,kakao,testPlugins=[],sendVerificationOTP}={}){
  const binding=configuredAuthBinding({environment,customerOrigin,issuer,mode});
  const baseUrl=mode==='callback'?issuer:customerOrigin+'/functions/v1/core-customer-auth',productionUrl=issuer;
  const base=new URL(baseUrl),production=new URL(productionUrl);
  const databaseBinding=getConfiguredCoreAuthPoolBinding(database);
  if(typeof memory!=='boolean'||!Array.isArray(testPlugins)||(sendVerificationOTP!==undefined&&typeof sendVerificationOTP!=='function')||
    [secret,proxySecret].some(x=>typeof x!=='string'||x.length<32||x.length>8192||/[\x00-\x1f\x7f]/.test(x))||
    (memory?database!==undefined:!databaseBinding||databaseBinding.environment!==environment||databaseBinding.projectRef!==binding.projectRef)||
    (!memory&&testPlugins.length))throw Object.assign(new Error('CUSTOMER_AUTH_CONFIGURATION_INVALID'),{code:'CUSTOMER_AUTH_CONFIGURATION_INVALID'});
  const socialProviders={};
  const configured=value=>Boolean(value?.clientId&&value?.clientSecret);
  if(configured(google))socialProviders.google={...google,scope:['openid','email','profile']};
  if(configured(kakao))socialProviders.kakao={...kakao,disableDefaultScope:true,scope:[],
    mapProfileToUser:profile=>{
      if(!/^[0-9]{1,30}$/.test(String(profile.id)))throw Error('KAKAO_IDENTITY_INVALID');
      return {name:'카카오 계정',email:'kakao_'+profile.id+'@identity.thefa.invalid',emailVerified:false};
    }};
  async function verifyBrowserBinding(_entry,ctx){
    if(mode==='callback'||!ctx?.path?.endsWith('/oauth-proxy'))return;
    const expected=(await getOAuthState())?.serverContext?.coreBrowserBinding;
    const candidates=(ctx.headers?.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(BINDING_COOKIE+'='));
    const actual=candidates.length===1?candidates[0].slice(BINDING_COOKIE.length+1):'';
    if(typeof expected!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(actual)||actual.length!==expected.length||
      !timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new APIError('FORBIDDEN',{code:'BROWSER_BINDING_REQUIRED'});
  }
  async function bindSession(entry,ctx){
    if(mode==='https'&&typeof sendVerificationOTP==='function'&&ctx?.path==='/sign-in/email-otp')
      return {data:{...entry,coreProviderId:'email',expiresAt:new Date(Date.now()+12*3600000)}};
    await verifyBrowserBinding(entry,ctx);
    if(mode==='callback'||!ctx?.path?.endsWith('/oauth-proxy'))return;
    const state=(await getOAuthState())?.serverContext;
    return {data:{...entry,coreFlowHash:state.coreFlowHash,coreProviderId:state.coreProviderId}};
  }
  const mailDelivery=new AsyncLocalStorage();
  const deliverOtp=async data=>{const receipt=mailDelivery.getStore();try{await sendVerificationOTP(data);if(receipt)receipt.accepted=true;}catch{if(receipt)receipt.failed=true;throw Error('EMAIL_DELIVERY_UNAVAILABLE');}};
  const auth=betterAuth({appName:'THE FA Core',baseURL:base.origin,basePath:base.pathname,secret,database,
    logger:{disabled:true},telemetry:{enabled:false},emailAndPassword:{enabled:false},socialProviders,
    trustedOrigins:[production.origin,customerOrigin],
    account:{accountLinking:{enabled:false},encryptOAuthTokens:true,storeStateStrategy:'database'},
    session:{expiresIn:30*86400,updateAge:86400,disableSessionRefresh:typeof sendVerificationOTP==='function',cookieCache:{enabled:false},additionalFields:{coreFlowHash:{type:'string',required:false,input:false},
      coreProviderId:{type:'string',required:false,input:false}}},
    hooks:{before:createAuthMiddleware(async ctx=>{
      if(mode==='callback'||ctx.path!=='/sign-in/social')return;
      const binding=ctx.headers?.get('x-thefa-oauth-binding');
      if(!/^[A-Za-z0-9_-]{43}$/.test(binding||''))throw new APIError('FORBIDDEN');
      const flow=ctx.headers?.get('x-thefa-account-flow');
      if(!/^[A-Za-z0-9_-]{43}$/.test(flow||''))throw new APIError('FORBIDDEN');
      await addOAuthServerContext({coreBrowserBinding:binding,coreFlowHash:createHash('sha256').update(flow).digest('hex'),
        coreProviderId:ctx.body.provider});
    })},
    databaseHooks:{user:{create:{before:verifyBrowserBinding}},session:{create:{before:bindSession}}},
    advanced:{database:{generateId:()=>randomUUID()},cookiePrefix:'thefa-core-customer',useSecureCookies:base.protocol==='https:'},
    plugins:[oAuthProxy({productionURL:production.origin,currentURL:base.origin,secret:proxySecret,maxAge:60}),
      ...(mode==='https'&&typeof sendVerificationOTP==='function'?[emailOTP({otpLength:6,expiresIn:300,allowedAttempts:5,storeOTP:'hashed',sendVerificationOTP:deliverOtp})]:[]),...testPlugins]});
  async function fetch(request){
    const url=new URL(request.url);
    const h=request.headers;
    if((h.has('host')&&h.get('host')!==base.host)||(h.has('x-forwarded-host')&&h.get('x-forwarded-host')!==base.host)||
      (h.has('x-forwarded-proto')&&h.get('x-forwarded-proto')!=='https')||h.has('forwarded')||h.has('x-original-url'))return fail(403,'CUSTOMER_AUTH_ORIGIN_INVALID');
    if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname+'/'))return fail(404,'NOT_FOUND');
    const keys=new Set();for(const key of url.searchParams.keys()){if(keys.has(key))return fail(400,'CUSTOMER_AUTH_QUERY_INVALID');keys.add(key);}
    const route=url.pathname.slice(base.pathname.length);
    if(mode==='callback'&&route==='/customer/providers'&&request.method==='GET'){
      if(url.search)return fail(400,'CUSTOMER_AUTH_QUERY_INVALID');
      const providers=Object.entries(PROVIDERS).map(([id,label])=>({id,label,enabled:Boolean(socialProviders[id]),
        clientId:socialProviders[id]?.clientId||null,reason:socialProviders[id]?null:'PROVIDER_SETUP_REQUIRED'}));
      return Response.json({applicationId:'THE_FA_CORE_CUSTOMER',issuer:productionUrl,providers},
        {headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
    }
    const match=/^\/callback\/(google|kakao)(\/oauth-proxy)?$/.exec(route);
    if(!match||request.method!=='GET')return fail(404,'NOT_FOUND');
    if(!socialProviders[match[1]])return fail(503,'LOGIN_PROVIDER_NOT_READY');
    if((mode==='callback'&&match[2])||(mode!=='callback'&&!match[2]))return fail(404,'NOT_FOUND');
    const response=await auth.handler(request);
    response.headers.set('cache-control','no-store');response.headers.set('referrer-policy','no-referrer');
    return response;
  }
  async function start({provider,headers=new Headers(),flow=randomBytes(32).toString('base64url')}={}){
    if(mode==='callback'||!socialProviders[provider])throw Error('LOGIN_PROVIDER_NOT_READY');
    if(mode==='https'&&!/^[A-Za-z0-9_-]{43}$/.test(flow))throw Error('HTTPS_FLOW_BINDING_INVALID');
    const binding=randomBytes(32).toString('base64url'),internalHeaders=new Headers(headers);
    internalHeaders.set('x-thefa-oauth-binding',binding);
    internalHeaders.set('x-thefa-account-flow',flow);
    const browserOrigin=customerOrigin;
    const response=await auth.api.signInSocial({headers:internalHeaders,body:{provider,callbackURL:browserOrigin+'/auth/complete',
      errorCallbackURL:browserOrigin+'/login#login-failed'},asResponse:true});
    response.headers.append('set-cookie',BINDING_COOKIE+'='+binding+'; Path='+base.pathname+'; Max-Age=600; HttpOnly; SameSite=Lax'+(mode==='https'?'; Secure':''));
    return response;
  }
  async function sendEmailCode({headers,email}){
    if(mode!=='https'||typeof sendVerificationOTP!=='function')throw Error('EMAIL_LOGIN_NOT_CONFIGURED');
    const receipt={accepted:false,failed:false};
    return mailDelivery.run(receipt,async()=>{await auth.api.sendVerificationOTP({headers,body:{email,type:'sign-in'}});
      if(!receipt.accepted||receipt.failed)throw Error('EMAIL_DELIVERY_UNAVAILABLE');return {accepted:true};});
  }
  const service={auth,baseUrl,fetch,start,...(mode==='https'&&typeof sendVerificationOTP==='function'?{sendEmailCode}:{})};bindings.set(service,binding);return service;
}
