import {createHash,createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readVerifiedLegacyBinding} from './customer-migration-receipts.mjs';

const AUTH_COOKIE='thefa_customer_auth_v1',FLOW_COOKIE='thefa_customer_oauth_flow';
const sha=x=>createHash('sha256').update(x).digest('hex');
const bad=(status,code)=>Object.assign(new Error(code),{status,code});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guestPattern=/^guest_[a-f0-9]{48}@temporary\.thefa\.invalid$/;
const labels={google:'Google',kakao:'카카오',apple:'Apple'};
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const registryId='tenant_'+sha('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1');
const empty=()=>({flows:{},sessions:{},accounts:{},claims:{},attempts:{}});

// R13 lifecycle with explicit server persistence and an independently signed legacy
// binding. This candidate does not classify an unknown UUID as a new customer.
export function createCustomerAccountLifecycle({origin,backendUrl,applicationId,publishableKey,persistence,secret,tenantKey,readTrustedReceipt,
  redirectReady=false,requestedProviders=['google','kakao'],fetchImpl=globalThis.fetch,clock=Date.now,identityBackend=null}={}){
  const own=new URL(origin);
  // The customer product must not reuse the existing operational user pool.
  if(applicationId!=='THE_FA_CORE_CUSTOMER'||['https://cgrppxfdurpzzfvkmfte.supabase.co',
    'https://furfjhymxqsbhvuyeqpx.supabase.co'].includes(backendUrl))
    throw bad(503,'DEDICATED_CORE_AUTH_PROJECT_REQUIRED');
  const proxy=Boolean(identityBackend);
  if(proxy&&(identityBackend.kind!=='THE_FA_CORE_PROXY_V1'||
    backendUrl!=='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth'||
    ['start','complete','remote','handle'].some(k=>typeof identityBackend[k]!=='function')))
    throw bad(503,'DEDICATED_CORE_AUTH_PROJECT_REQUIRED');
  if(own.origin!==origin||(!proxy&&!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(backendUrl||''))||
    (!proxy&&(typeof publishableKey!=='string'||publishableKey.length<20))||!proxy||
    typeof persistence?.registry!=='function'||typeof persistence?.workspace!=='function'||typeof readTrustedReceipt!=='function'||
    !Buffer.isBuffer(secret)||secret.length!==32||typeof tenantKey!=='string'||tenantKey.length<32||
    !Array.isArray(requestedProviders)||!requestedProviders.length||requestedProviders.some(p=>!labels[p]))
    throw bad(503,'ACCOUNT_AUTH_CONFIGURATION_REQUIRED');
  const encryptionKey=createHash('sha256').update(secret).update('ACCOUNT_SESSION_ENCRYPTION_V1').digest();
  const opaque=x=>createHmac('sha256',secret).update(x).digest('hex');
  const store=()=>persistence.registry(registryId);
  async function registry(){const s=store();try{await s.init();return structuredClone(s.state.customerAccounts||empty());}finally{await s.close();}}
  async function mutate(fn){const s=store();try{await s.init();return await s.mutate(async state=>{
    const r=state.customerAccounts??=empty();
    for(const [id,f] of Object.entries(r.flows))if(f.expiresAt<=clock())delete r.flows[id];
    for(const [id,f] of Object.entries(r.sessions))if(f.expiresAt<=clock())delete r.sessions[id];
    return fn(r);
  });}finally{await s.close();}}
  function seal(value){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
  }
  function open(value){
    try{const raw=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',encryptionKey,raw.subarray(0,12));
      decipher.setAuthTag(raw.subarray(12,28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));
    }catch{throw bad(401,'ACCOUNT_SESSION_INVALID');}
  }
  function token(header,name){
    if(typeof header!=='string'||header.length>8000)throw bad(401,'ACCOUNT_SESSION_INVALID');
    const items=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
    if(!items.length)return null;
    if(items.length!==1||!tokenPattern.test(items[0].slice(name.length+1)))throw bad(401,'ACCOUNT_SESSION_INVALID');
    return items[0].slice(name.length+1);
  }
  const cookie=(name,value,seconds)=>name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds+
    (own.protocol==='https:'?'; Secure':'');
  async function remote(route,{method='GET',body,accessToken}={}){
    if(proxy)return identityBackend.remote(route,{method,body,accessToken});
    let response;
    try{response=await fetchImpl(backendUrl+'/auth/v1'+route,{method,headers:{apikey:publishableKey,
      ...(accessToken?{authorization:'Bearer '+accessToken}:{}),'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
    }catch{throw bad(503,'ACCOUNT_AUTH_UNAVAILABLE');}
    if(!response.ok)throw bad(response.status===401||response.status===400?401:503,'ACCOUNT_AUTH_REJECTED');
    if(response.status===204)return null;
    let bytes=0;const chunks=[];
    try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>100000)throw Error();chunks.push(chunk);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{throw bad(503,'ACCOUNT_AUTH_RESPONSE_INVALID');}
  }
  let settings=null,checkedAt=0;
  async function providers(){
    try{if(!settings||clock()-checkedAt>60000){settings=await remote('/settings');checkedAt=clock();}}
    catch{settings=null;}
    return requestedProviders.map(id=>({id,label:labels[id],
      enabled:Boolean(redirectReady&&settings?.external?.[id]),
      reason:!settings?'AUTH_UNAVAILABLE':!settings.external?.[id]?'PROVIDER_SETUP_REQUIRED':
        !redirectReady?'CALLBACK_SETUP_REQUIRED':null}));
  }
  async function start({provider,guestEmail,peer,headers}={}){
    if(!(await providers()).some(p=>p.id===provider&&p.enabled))throw bad(503,'LOGIN_PROVIDER_NOT_READY');
    if(guestEmail!==null&&guestEmail!==undefined&&!guestPattern.test(guestEmail))throw bad(400,'GUEST_IDENTITY_INVALID');
    if(typeof peer!=='string'||peer.length<1||peer.length>100)throw bad(400,'LOGIN_PEER_REQUIRED');
    const flow=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    await mutate(r=>{
      const ip=opaque('LOGIN_IP:'+peer),old=r.attempts[ip];
      for(const [id,x] of Object.entries(r.attempts))if(x.until<=clock())delete r.attempts[id];
      if(Object.keys(r.flows).length>=1000||(old?.until>clock()&&old.count>=30))throw bad(429,'LOGIN_RATE_LIMIT');
      r.attempts[ip]=old?.until>clock()?{...old,count:old.count+1}:{until:clock()+600000,count:1};
      r.flows[opaque('FLOW:'+flow)]={expiresAt:clock()+600000,used:false,payload:seal({verifier,guestEmail:guestEmail||null,provider})};
    });
    if(proxy){const redirected=await identityBackend.start({provider,flow,headers});
      return {...redirected,cookie:cookie(FLOW_COOKIE,flow,600)};}
    const target=new URL(backendUrl+'/auth/v1/authorize');
    target.search=new URLSearchParams({provider,redirect_to:origin+'/auth/callback',
      code_challenge:challenge,code_challenge_method:'s256'}).toString();
    return {location:target.href,cookie:cookie(FLOW_COOKIE,flow,600)};
  }
  const validateUser=user=>{
    if(!user||typeof user.id!=='string'||!UUID.test(user.id))throw bad(401,'ACCOUNT_IDENTITY_INVALID');
    return user;
  };
  function tokens(data){
    if(typeof data?.access_token!=='string'||data.access_token.length<8||data.access_token.length>10000||
      typeof data.refresh_token!=='string'||data.refresh_token.length<8||data.refresh_token.length>10000||
      !Number.isFinite(data.expires_in)||data.expires_in<60||data.expires_in>86400)
      throw bad(401,'ACCOUNT_TOKEN_RESPONSE_INVALID');
    return {access:data.access_token,refresh:data.refresh_token,accessExpiresAt:clock()+data.expires_in*1000};
  }
  async function finish({code,cookie:header,acquireWorkspaces=async()=>async()=>{}}={}){
    if(proxy?code!==undefined:(typeof code!=='string'||!/^[A-Za-z0-9_-]{16,256}$/.test(code)))throw bad(401,'LOGIN_CALLBACK_INVALID');
    const flow=token(header||'',FLOW_COOKIE);if(!flow)throw bad(401,'LOGIN_FLOW_REQUIRED');
    const flowData=await mutate(r=>{
      const f=r.flows[opaque('FLOW:'+flow)];
      if(!f||f.used||f.expiresAt<=clock())throw bad(401,'LOGIN_FLOW_EXPIRED');
      f.used=true;return open(f.payload);
    });
    const exchanged=proxy?await identityBackend.complete({cookie:header,flow}):
      await remote('/token?grant_type=pkce',{method:'POST',body:{auth_code:code,code_verifier:flowData.verifier}});
    if(proxy&&exchanged.user?.coreProviderId!==flowData.provider)throw bad(401,'ACCOUNT_PROVIDER_MISMATCH');
    const current=tokens(exchanged),user=validateUser(await remote('/user',{accessToken:current.access}));
    if(exchanged.user?.id!==user.id)throw bad(401,'ACCOUNT_IDENTITY_MISMATCH');
    const account=opaque(backendUrl+'|'+user.id),sessionToken=randomBytes(32).toString('base64url');
    const displayName=String(user.user_metadata?.full_name||user.user_metadata?.name||user.email||'내 계정').slice(0,80);
    const binding=await readVerifiedLegacyBinding(readTrustedReceipt,account);
    if(!binding||binding.userId!==user.id||binding.provider!==flowData.provider||binding.backendUrl!==backendUrl||
      binding.keyHashes.accountSecret!==sha(secret)||binding.keyHashes.tenantKey!==sha(Buffer.from(tenantKey)))
      throw bad(503,'ACCOUNT_MIGRATION_BINDING_REQUIRED');
    const registered=await registry(),knownTarget=registered.accounts[account]?.workspaceEmail;
    if(!knownTarget||knownTarget!==binding.workspaceEmail||(flowData.guestEmail&&flowData.guestEmail!==knownTarget))
      throw bad(503,'ACCOUNT_MIGRATION_BINDING_REQUIRED');
    if(binding.claimKeys.some(key=>registered.claims[key]!==account))throw bad(503,'ACCOUNT_MIGRATION_BINDING_REQUIRED');
    const release=await acquireWorkspaces([...new Set([flowData.guestEmail,knownTarget].filter(Boolean))]);
    try{await mutate(async r=>{
      const guestEmail=flowData.guestEmail,claim=guestEmail?r.claims[opaque(guestEmail)]:null;
      if(claim&&claim!==account)throw bad(409,'GUEST_HISTORY_ALREADY_ATTACHED');
      const target=r.accounts[account]?.workspaceEmail;
      if(target!==knownTarget||binding.claimKeys.some(key=>r.claims[key]!==account))throw bad(409,'ACCOUNT_WORKSPACE_CHANGED');
      if(Object.keys(r.sessions).length>=2000)throw bad(503,'ACCOUNT_SESSION_CAPACITY');
      if(guestEmail){
        const src=persistence.workspace(guestEmail);try{await src.init();
          if(Object.values(src.state.customerChat?.turnRequests||{}).some(t=>t.phase==='MODEL_REQUEST_PENDING'))
            throw bad(409,'FINISH_CHAT_BEFORE_LOGIN');
        }finally{await src.close();}
      }
      // Assignment/guest merge requires separate import/new-account provenance.
      // A completed legacy login keeps the imported account record byte-for-byte.
      if(guestEmail)r.claims[opaque(guestEmail)]=account;
      r.sessions[opaque('SESSION:'+sessionToken)]={expiresAt:clock()+30*86400000,payload:seal({
        ...current,account,userId:user.id,displayName,provider:flowData.provider,workspaceEmail:target})};
    });}finally{await release();}
    return {cookie:cookie(AUTH_COOKIE,sessionToken,30*86400),clearFlowCookie:cookie(FLOW_COOKIE,'',0)};
  }
  const refreshing=new Map();
  async function refresh(id,entry){
    if(refreshing.has(id))return refreshing.get(id);
    const pending=(async()=>{
      await mutate(r=>{
        if(!r.sessions[id]||r.sessions[id].refreshingUntil>clock())throw bad(401,'ACCOUNT_REFRESH_BUSY');
        r.sessions[id].refreshingUntil=clock()+15000;
      });
      try{
        const result=await remote('/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:entry.refresh}});
        const next={...entry,...tokens(result)};
        const user=validateUser(await remote('/user',{accessToken:next.access}));
        if(user.id!==entry.userId)throw bad(401,'ACCOUNT_IDENTITY_MISMATCH');
        await mutate(r=>{if(!r.sessions[id])throw bad(401,'ACCOUNT_SESSION_ENDED');
          r.sessions[id].payload=seal(next);delete r.sessions[id].refreshingUntil;});
        return next;
      }catch(error){await mutate(r=>{delete r.sessions[id];});throw error;}
    })();
    refreshing.set(id,pending);try{return await pending;}finally{refreshing.delete(id);}
  }
  async function session(header=''){
    const value=token(header,AUTH_COOKIE);if(!value)return null;
    const id=opaque('SESSION:'+value),r=await registry(),record=r.sessions[id];
    if(!record||record.expiresAt<=clock())throw bad(401,'ACCOUNT_SESSION_EXPIRED');
    let entry=open(record.payload);
    if(entry.accessExpiresAt<=clock()+30000)entry=await refresh(id,entry);
    const user=validateUser(await remote('/user',{accessToken:entry.access}));
    if(user.id!==entry.userId)throw bad(401,'ACCOUNT_IDENTITY_MISMATCH');
    return {workspaceEmail:entry.workspaceEmail,principalId:entry.account,user:{id:entry.userId,displayName:entry.displayName,provider:entry.provider}};
  }
  async function logout(header=''){
    const value=token(header,AUTH_COOKIE);
    if(value){const id=opaque('SESSION:'+value);const old=await mutate(r=>{const entry=r.sessions[id];delete r.sessions[id];return entry||null;});
      if(old)try{await remote('/logout?scope=local',{method:'POST',accessToken:open(old.payload).access});}catch{/* Local session is already revoked. */}}
    return cookie(AUTH_COOKIE,'',0);
  }
  async function isClaimedGuest(email){return Boolean((await registry()).claims[opaque(email)]);}
  return Object.freeze({providers,start,finish,session,logout,isClaimedGuest,
    ...(proxy?{proxyFetch:identityBackend.handle}:{} )});
}
