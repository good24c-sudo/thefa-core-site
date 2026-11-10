import {createHmac} from 'node:crypto';
import {SupabaseRest} from './inherited/store.mjs';
import {TenantStateStore} from './inherited/customer-tenant-storage.mjs';
import {readCoreOidcIdentity} from './thefa-oidc-client.mjs';

const PROJECT='furfjhymxqsbhvuyeqpx';
const ISSUER='https://'+PROJECT+'.supabase.co/auth/v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const fail=code=>Object.assign(new Error(code),{code,status:503});
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest('hex');
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));

export function readStageOidcAccountConfig(env=process.env){
 if(env.VERCEL_ENV!=='preview'||env.THEFA_CORE_STAGE_BRIDGE_ENABLED!=='true'||
    env.THEFA_CORE_OIDC_ISSUER!==ISSUER||
    !/^https:\/\/thefa-core-customer-[a-z0-9-]+\.vercel\.app$/.test(env.THEFA_CORE_OIDC_ORIGIN||'')||
    typeof env.THEFA_CORE_OIDC_CLIENT_ID!=='string'||!UUID.test(env.THEFA_CORE_OIDC_CLIENT_ID)||
    typeof env.THEFA_CORE_STAGE_SERVICE_ROLE_KEY!=='string'||
    env.THEFA_CORE_STAGE_SERVICE_ROLE_KEY.length<60||
    !/^[A-Za-z0-9_-]{43}$/.test(env.THEFA_CORE_STAGE_ACCOUNT_KEY_BASE64URL||'')||
    !/^[A-Za-z0-9_-]{43}$/.test(env.THEFA_CORE_STAGE_ALLOWANCE_KEY_BASE64URL||'')||
    !/^[A-Za-z0-9_-]{43,128}$/.test(env.THEFA_CORE_STAGE_TENANT_KEY||''))
   throw fail('THEFA_OIDC_STAGE_ACCOUNT_CONFIGURATION_REQUIRED');
 const key=Buffer.from(env.THEFA_CORE_STAGE_ACCOUNT_KEY_BASE64URL,'base64url');
 const allowanceKey=Buffer.from(env.THEFA_CORE_STAGE_ALLOWANCE_KEY_BASE64URL,'base64url');
 if(key.length!==32||allowanceKey.length!==32||key.equals(allowanceKey)||
    env.THEFA_CORE_STAGE_TENANT_KEY===env.THEFA_CORE_STAGE_ACCOUNT_KEY_BASE64URL)
    throw fail('THEFA_OIDC_STAGE_ACCOUNT_KEY_INVALID');
 const registryId='tenant_'+hmac(key,'THEFA_CORE_OIDC_REGISTRY_V1\0'+ISSUER);
 const rest=new SupabaseRest({url:'https://'+PROJECT+'.supabase.co',serviceRoleKey:env.THEFA_CORE_STAGE_SERVICE_ROLE_KEY});
 return Object.freeze({key,allowanceKey,registryId,rest,tenantKey:env.THEFA_CORE_STAGE_TENANT_KEY,
  issuer:ISSUER,clientId:env.THEFA_CORE_OIDC_CLIENT_ID});
}
function keys(c,subject){
 if(typeof subject!=='string'||!UUID.test(subject))throw fail('OIDC_SUBJECT_INVALID');
 const id=hmac(c.key,'THEFA_CORE_OIDC_SUBJECT_V1\0'+c.issuer+'\0'+subject);
 return {id,email:'oidc_'+id+'@accounts.thefa.invalid'};
}
function inspect(state,c,subject){
 if(!plain(state)||!plain(state.thefaOidcAccounts))return null;
 const r=state.thefaOidcAccounts;
 if(r.contract!=='THEFA_OIDC_STAGE_ACCOUNTS_V1'||r.issuer!==c.issuer||r.clientId!==c.clientId||
    !plain(r.accounts)||Object.keys(r.accounts).length>10000)throw fail('OIDC_STAGE_REGISTRY_INVALID');
 const k=keys(c,subject),rec=r.accounts[k.id];
 if(rec==null)return null;
 if(!plain(rec)||rec.subject!==subject||rec.principalId!==k.id||
    rec.workspaceEmail!==k.email||rec.issuer!==c.issuer||rec.clientId!==c.clientId||rec.contract!=='THEFA_OIDC_STAGE_LINK_V1')
    throw fail('OIDC_STAGE_ACCOUNT_BINDING_MISMATCH');
 return Object.freeze({principalId:k.id,workspaceEmail:k.email,provider:'oidc',
  accountProvenance:'LAUNCH_ACCOUNT_CONFIRMED',sessionVerified:true,subject});
}
async function readRegistry(c){
 const rows=await c.rest.request('/core_console_state_v3?workspace_id=eq.'+c.registryId+'&select=state,version&limit=1');
 if(!Array.isArray(rows)||rows.length>1)throw fail('OIDC_STAGE_REGISTRY_READ_FAILED');
 if(!rows.length)return null;
 if(!Number.isSafeInteger(rows[0].version)||rows[0].version<1||!plain(rows[0].state))
  throw fail('OIDC_STAGE_REGISTRY_CORRUPT');
 return rows[0].state;
}
export async function readStageOidcCustomerAccount(cookieHeader,{env=process.env,clock=Date.now}={}){
 const identity=readCoreOidcIdentity(cookieHeader,{env,clock});
 if(!identity)return null;
 const c=readStageOidcAccountConfig(env);
 const state=await readRegistry(c);
 return state?inspect(state,c,identity.subject):null;
}
/** Invoked ONLY after strict Supabase ID token verification in the real callback.
 * Atomic registration is separate from authentication. Unknown writes are not replayed. */
export async function admitVerifiedStageOidcSubject({issuer,subject,audience},{env=process.env}={}){
 const c=readStageOidcAccountConfig(env);
 if(issuer!==c.issuer||audience!==c.clientId)throw fail('OIDC_STAGE_ISSUER_AUDIENCE_MISMATCH');
 const old=await readRegistry(c);
 const already=old&&inspect(old,c,subject);
 if(already)return already;
 const k=keys(c,subject);
 const store=new TenantStateStore(c.rest,{workspaceId:c.registryId});
 try{
  await store.init();
  await store.mutate(state=>{
   if(!plain(state.thefaOidcAccounts)){
    if(state.thefaOidcAccounts!==undefined)throw fail('OIDC_STAGE_REGISTRY_CORRUPT');
    state.thefaOidcAccounts={contract:'THEFA_OIDC_STAGE_ACCOUNTS_V1',
     issuer:c.issuer,clientId:c.clientId,accounts:{}};
   }
   const r=state.thefaOidcAccounts;
   if(r.contract!=='THEFA_OIDC_STAGE_ACCOUNTS_V1'||r.issuer!==c.issuer||r.clientId!==c.clientId||!plain(r.accounts))
    throw fail('OIDC_STAGE_REGISTRY_BINDING_INVALID');
   const current=inspect(state,c,subject);
   if(current)return;
   if(Object.keys(r.accounts).length>=10000)throw fail('OIDC_STAGE_CAPACITY');
   r.accounts[k.id]={contract:'THEFA_OIDC_STAGE_LINK_V1',
    issuer:c.issuer,clientId:c.clientId,subject,principalId:k.id,workspaceEmail:k.email,
    createdAt:new Date().toISOString()};
  });
 }catch{throw fail('OIDC_STAGE_ACCOUNT_ADMISSION_UNCERTAIN_NO_AUTOREPLAY')}
 finally{try{await store.close()}catch{throw fail('OIDC_STAGE_ACCOUNT_LEASE_CLEANUP_UNCERTAIN')}}
 const after=await readRegistry(c),result=after&&inspect(after,c,subject);
 if(!result)throw fail('OIDC_STAGE_ACCOUNT_ADMISSION_NOT_CONFIRMED');
 return result;
}
