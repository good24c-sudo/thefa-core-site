import {createHash,timingSafeEqual} from 'node:crypto';
import {getConfiguredCustomerAuthBinding} from './service.mjs';
import {LEGACY_IDENTITY_REALM} from './configuration.mjs';

const bad=(status,code)=>Object.assign(new Error(code),{status,code});
export function createConfiguredCoreProxyIdentityBackend({service,issuer,customerOrigin,fetchImpl=globalThis.fetch,clock=Date.now}={}){
  const binding=getConfiguredCustomerAuthBinding(service);
  if(!binding||binding.mode!=='https'||binding.issuer!==issuer||binding.customerOrigin!==customerOrigin||
    service.baseUrl!==customerOrigin+'/functions/v1/core-customer-auth'||typeof fetchImpl!=='function'||typeof clock!=='function')throw bad(503,'DEDICATED_IDENTITY_BACKEND_REQUIRED');
  let cached=null,checked=0;
  async function capabilities(){
    if(cached&&clock()-checked<30000)return cached;
    const response=await fetchImpl(issuer+'/customer/providers',{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw bad(503,'ACCOUNT_AUTH_UNAVAILABLE');
    const text=await response.text();if(text.length>20000)throw bad(503,'ACCOUNT_AUTH_RESPONSE_INVALID');
    const data=JSON.parse(text);
    if(data.applicationId!=='THE_FA_CORE_CUSTOMER'||data.issuer!==issuer||!Array.isArray(data.providers)||data.providers.length!==2||
      !['google','kakao'].every(id=>data.providers.filter(p=>p?.id===id).length===1))
      throw bad(503,'DEDICATED_IDENTITY_BACKEND_REQUIRED');
    const external={};
    for(const id of ['google','kakao']){
      const local=service.auth.options.socialProviders?.[id];
      external[id]=data.providers.filter(x=>x.id===id).length===1&&data.providers.some(x=>
        x.id===id&&x.enabled===true&&Boolean(local?.clientId)&&x.clientId===local.clientId);
    }
    cached={external};checked=clock();return cached;
  }
  async function credential(header=''){
    const ctx=await service.auth.$context,name=ctx.authCookies.sessionToken.name;
    if(typeof header!=='string'||header.length>10000)throw bad(401,'ACCOUNT_SESSION_INVALID');
    const names=new Set();for(const part of header.split(';')){const pair=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\x00-\x20\x7f;,]*)$/.exec(part.trim());if(!pair||names.has(pair[1]))throw bad(401,'ACCOUNT_SESSION_INVALID');names.add(pair[1]);}
    const matches=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
    if(matches.length!==1||matches[0].length>2000)throw bad(401,'ACCOUNT_SESSION_REQUIRED');
    return matches[0];
  }
  async function verified(accessToken){
    const value=await credential(accessToken);
    const current=await service.auth.api.getSession({headers:new Headers({cookie:value})});
    const expires=new Date(current?.session?.expiresAt).getTime();
    if(!current?.user?.id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(current.user.id)||current.session?.userId!==current.user.id||
      !['google','kakao'].includes(current.session?.coreProviderId)||
      !Number.isFinite(expires)||expires<=clock())throw bad(401,'ACCOUNT_SESSION_INVALID');
    return {current,value};
  }
  const user=current=>({id:current.user.id,coreProviderId:current.session.coreProviderId,
    user_metadata:{full_name:current.user.name||'내 계정'}});
  function lease(current,value){
    const expires_in=Math.min(3600,Math.floor((new Date(current.session.expiresAt).getTime()-clock())/1000));
    if(expires_in<60)throw bad(401,'ACCOUNT_SESSION_EXPIRED');
    return {access_token:value,refresh_token:value,expires_in,user:user(current)};
  }
  return {kind:'THE_FA_CORE_PROXY_V1',legacyIdentityRealm:LEGACY_IDENTITY_REALM,issuer,
    async start({provider,flow,headers}={}){
      if(!(await capabilities()).external[provider])throw bad(503,'LOGIN_PROVIDER_NOT_READY');
      const response=await service.start({provider,flow,headers});
      if(!response.ok)throw bad(503,'LOGIN_PROVIDER_NOT_READY');
      const result=await response.json(),target=new URL(result.url);
      if(!['https://accounts.google.com','https://kauth.kakao.com'].includes(target.origin))throw bad(503,'LOGIN_TARGET_INVALID');
      return {location:target.href,cookies:response.headers.getSetCookie()};
    },
    async complete({cookie,flow}={}){
      if(!/^[A-Za-z0-9_-]{43}$/.test(flow||''))throw bad(401,'LOGIN_FLOW_REQUIRED');
      const {current,value}=await verified(await credential(cookie));
      const expected=createHash('sha256').update(flow).digest('hex'),actual=current.session.coreFlowHash;
      if(typeof actual!=='string'||actual.length!==64||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))
        throw bad(401,'ACCOUNT_FLOW_MISMATCH');
      return lease(current,value);
    },
    async remote(route,{accessToken,body}={}){
      if(route==='/settings')return capabilities();
      if(route==='/user')return user((await verified(accessToken)).current);
      if(route==='/token?grant_type=refresh_token'){
        const {current,value}=await verified(body?.refresh_token);return lease(current,value);
      }
      if(route==='/logout?scope=local'){
        const value=await credential(accessToken);await service.auth.api.signOut({headers:new Headers({cookie:value})});return null;
      }
      throw bad(404,'UNKNOWN_IDENTITY_ROUTE');
    },
    handle:request=>service.fetch(request)};
}
