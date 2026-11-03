import {SupabaseRest} from '../store.mjs';
import {validateCustomerOrigin} from '../customer-origin-policy.mjs';
import {createConfiguredCoreProxyIdentityBackend} from './auth/identity-backend.mjs';
import {getConfiguredCustomerAuthBinding} from './auth/service.mjs';
import {createCustomerAccountPersistence,createReadOnlyCustomerAccountRegistry} from '../customer-account-persistence.mjs';
import {createCustomerAccountLifecycle} from '../customer-account-lifecycle.mjs';
import {createReadOnlyLegacyAccountResolver,createCustomerSessionVerifier} from '../customer-session-verifier.mjs';
import {createLegacyMigrationVerifier} from '../customer-migration-receipts.mjs';
import {createCustomerRuntime} from '../customer-runtime-composition.mjs';
import {createCustomerAuthRoutes} from '../customer-auth-routes.mjs';
import {createCustomerApplication} from '../customer-application.mjs';
import {createCustomerNodeAdapter} from '../customer-node-adapter.mjs';

/** Explicit server-only composition of the reviewed existing engines. Construction
 * performs no I/O and does not provide Core authority, release admission, credentials,
 * an import, callback registration, or a live public entry point.
 * Only reconciled legacy customers can currently authorize; unknown UUIDs fail closed.
 */
export function createCustomerPublicComposition({config,authService,providerService,readTrustedReceipt,resolveLoginContext,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 try{
  const binding=getConfiguredCustomerAuthBinding(authService),providerBinding=getConfiguredCustomerAuthBinding(providerService);
  const origin=validateCustomerOrigin(config);
  if(!binding||!providerBinding||binding.mode!=='https'||providerBinding.mode!=='callback'||
    binding.customerOrigin!==origin||binding.environment!==config.environment||binding.issuer!==providerBinding.issuer||
    providerBinding.customerOrigin!==origin||providerBinding.environment!==binding.environment||
    config.supabaseUrl!=='https://'+binding.projectRef+'.supabase.co'||
    !Buffer.isBuffer(config.accountSecret)||config.accountSecret.length!==32||
    !Buffer.isBuffer(config.allowanceSecret)||config.allowanceSecret.length!==32||
    typeof readTrustedReceipt!=='function'||typeof resolveLoginContext!=='function'||typeof fetchImpl!=='function'||typeof clock!=='function'||config.redirectReady!==true)
   throw Error('INVALID_COMPOSITION');
  const rest=new SupabaseRest({url:config.supabaseUrl,serviceRoleKey:config.serviceRoleKey,fetcher:fetchImpl});Object.freeze(rest);
  const identityBackend=createConfiguredCoreProxyIdentityBackend({service:authService,issuer:binding.issuer,customerOrigin:origin,clock,
   fetchImpl:async url=>{if(url!==binding.issuer+'/customer/providers')throw Error('INVALID_PROVIDER_ROUTE');return providerService.fetch(new Request(url))}});
  const registryReader=createReadOnlyCustomerAccountRegistry({environment:config.environment,supabaseUrl:config.supabaseUrl,serviceRoleKey:config.serviceRoleKey,fetchImpl});
  const accountAuth=createCustomerAccountLifecycle({origin,backendUrl:binding.legacyIdentityRealm,applicationId:'THE_FA_CORE_CUSTOMER',
   persistence:createCustomerAccountPersistence({rest,tenantKey:config.tenantKey}),secret:config.accountSecret,tenantKey:config.tenantKey,
   readTrustedReceipt,redirectReady:true,identityBackend,clock});
  const sessionVerifier=createCustomerSessionVerifier({authService,clock,renewAccountSession:cookie=>accountAuth.session(cookie),resolveAccount:createReadOnlyLegacyAccountResolver({registryReader,
   backendUrl:binding.legacyIdentityRealm,accountSecret:config.accountSecret,readTrustedReceipt,clock})});
  const legacyMigrationVerifier=createLegacyMigrationVerifier({readTrustedReceipt,stableKeyProvenance:{backendUrl:binding.legacyIdentityRealm,
   accountSecret:config.accountSecret,allowanceSecret:config.allowanceSecret,tenantKey:config.tenantKey},readTargetState:async id=>{
    if(!/^tenant_[a-f0-9]{64}$/.test(id))return null;
    const rows=await rest.request('/core_console_state_v3?workspace_id=eq.'+id+'&select=workspace_id,state,version&limit=1');
    if(!Array.isArray(rows)||rows.length!==1||rows[0]?.workspace_id!==id||!Number.isSafeInteger(rows[0].version)||rows[0].version<1)return null;
    return {workspaceId:id,version:rows[0].version,state:rows[0].state};
   }});
  const runtime=createCustomerRuntime({config,sessionVerifier,legacyMigrationVerifier,fetchImpl,clock});
  const authRoutes=createCustomerAuthRoutes({authService,providerService,customerOrigin:origin,environment:config.environment,issuer:binding.issuer,accountAuth,resolveLoginContext});
  const application=createCustomerApplication({runtime,authRoutes,originConfig:config});
  return Object.freeze({application,nodeHandler:createCustomerNodeAdapter({application,customerOrigin:origin,environment:config.environment})});
 }catch{throw Object.assign(new Error('CUSTOMER_PUBLIC_COMPOSITION_CONFIGURATION_REQUIRED'),{status:503,code:'CUSTOMER_PUBLIC_COMPOSITION_CONFIGURATION_REQUIRED'})}
}
