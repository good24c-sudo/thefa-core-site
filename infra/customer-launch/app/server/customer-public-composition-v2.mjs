import {SupabaseRest} from './inherited/store.mjs';
import {createGoogleEmployeeEntitlementResolver,createLaunchEmployeeEntitlementResolver} from './employee-entitlement.mjs';
import {createFreshLaunchAccounts} from './fresh-launch-accounts.mjs';
import {validateCustomerOrigin} from './inherited/customer-origin-policy.mjs';
import {createConfiguredCoreProxyIdentityBackend} from './inherited/server/auth/identity-backend.mjs';
import {getConfiguredCustomerAuthBinding} from './inherited/server/auth/service.mjs';
import {createCustomerAccountPersistence,createReadOnlyCustomerAccountRegistry} from './inherited/customer-account-persistence.mjs';
import {createCustomerAccountLifecycleV2} from './customer-account-lifecycle-v2.mjs';
import {createUnifiedCustomerSessionVerifier} from './customer-session-verifier-v2.mjs';
import {createVerifiedProviderIdentityReader,createSignupClassifier,createSignupAccountAdmission} from './signup-classifier.mjs';
import {createReadOnlyLegacyAccountResolver,createCustomerSessionVerifier} from './inherited/customer-session-verifier.mjs';
import {createLegacyMigrationVerifier} from './inherited/customer-migration-receipts.mjs';
import {createCustomerRuntime} from './inherited/customer-runtime-composition.mjs';
import {createCustomerAuthRoutes} from './inherited/customer-auth-routes.mjs';
import {createCustomerApplication} from './inherited/customer-application.mjs';
import {createCustomerNodeAdapter} from './inherited/customer-node-adapter.mjs';

/** Explicit server-only composition of the reviewed existing engines. Construction
 * performs no I/O and does not provide Core authority, release admission, credentials,
 * an import, callback registration, or a live public entry point.
 * Reconciled legacy customers retain signed imports; independently verified new identities require atomic admission.
 */
export function createCustomerPublicCompositionV2({config,authService,providerService,database,inventory,readTrustedReceipt,resolveLoginContext,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 try{
  const binding=getConfiguredCustomerAuthBinding(authService),providerBinding=getConfiguredCustomerAuthBinding(providerService);
  const origin=validateCustomerOrigin(config);
  if(!binding||!providerBinding||binding.mode!=='https'||providerBinding.mode!=='callback'||
    binding.customerOrigin!==origin||binding.environment!==config.environment||binding.issuer!==providerBinding.issuer||
    providerBinding.customerOrigin!==origin||providerBinding.environment!==binding.environment||
    config.supabaseUrl!=='https://'+binding.projectRef+'.supabase.co'||
    !Buffer.isBuffer(config.accountSecret)||config.accountSecret.length!==32||
    !Buffer.isBuffer(config.allowanceSecret)||config.allowanceSecret.length!==32||
    (config.accountMode!=='fresh-launch'&&typeof readTrustedReceipt!=='function')||typeof resolveLoginContext!=='function'||typeof fetchImpl!=='function'||typeof clock!=='function'||config.redirectReady!==true)
   throw Error('INVALID_COMPOSITION');
  const rest=new SupabaseRest({url:config.supabaseUrl,serviceRoleKey:config.serviceRoleKey,fetcher:fetchImpl});Object.freeze(rest);
  if(config.accountMode==='fresh-launch'){
   const launchAccounts=createFreshLaunchAccounts({authService,rest,config,clock});
   const resolveEmployeeEntitlement=createLaunchEmployeeEntitlementResolver({authService,launchAccounts,fetchImpl,clock});
   const runtime=createCustomerRuntime({config,sessionVerifier:cookie=>launchAccounts.resolve(cookie),resolveEmployeeEntitlement,fetchImpl,clock});
   const authRoutes=createCustomerAuthRoutes({authService,providerService,customerOrigin:origin,environment:config.environment,issuer:binding.issuer,resolveLoginContext,launchAccounts});
   const application=createCustomerApplication({runtime,authRoutes,originConfig:config});
   return Object.freeze({application,nodeHandler:createCustomerNodeAdapter({application,customerOrigin:origin,environment:config.environment})});
  }
  const identityBackend=createConfiguredCoreProxyIdentityBackend({service:authService,issuer:binding.issuer,customerOrigin:origin,clock,
   fetchImpl:async url=>{if(url!==binding.issuer+'/customer/providers')throw Error('INVALID_PROVIDER_ROUTE');return providerService.fetch(new Request(url))}});
  const registryReader=createReadOnlyCustomerAccountRegistry({environment:config.environment,supabaseUrl:config.supabaseUrl,serviceRoleKey:config.serviceRoleKey,fetchImpl});
  const persistence=createCustomerAccountPersistence({rest,tenantKey:config.tenantKey});
  const readProviderIdentity=createVerifiedProviderIdentityReader({authService,database,accountSecret:config.accountSecret,identityRealm:binding.legacyIdentityRealm,clock});
  const classify=createSignupClassifier({inventory,stableKeys:config,clock});
  const admitNewAccount=createSignupAccountAdmission({inventory,persistence,accountSecret:config.accountSecret,clock});
  const accountAuth=createCustomerAccountLifecycleV2({origin,backendUrl:binding.legacyIdentityRealm,applicationId:'THE_FA_CORE_CUSTOMER',
   persistence,secret:config.accountSecret,tenantKey:config.tenantKey,readTrustedReceipt,redirectReady:true,identityBackend,clock,inventory,admitNewAccount,
   classifySession:async cookie=>{const proof=await readProviderIdentity(cookie);if(!proof)throw Object.assign(new Error('ACCOUNT_SESSION_REQUIRED'),{status:401});return classify(proof)}});
  const legacyVerifier=createCustomerSessionVerifier({authService,clock,renewAccountSession:cookie=>accountAuth.session(cookie),resolveAccount:createReadOnlyLegacyAccountResolver({registryReader,
   backendUrl:binding.legacyIdentityRealm,accountSecret:config.accountSecret,readTrustedReceipt,clock})});
  const sessionVerifier=createUnifiedCustomerSessionVerifier({legacyVerifier,registryReader,accountSecret:config.accountSecret,inventory,readProviderIdentity,classify,renewAccountSession:cookie=>accountAuth.session(cookie),clock});
  const legacyMigrationVerifier=createLegacyMigrationVerifier({readTrustedReceipt,stableKeyProvenance:{backendUrl:binding.legacyIdentityRealm,
   accountSecret:config.accountSecret,allowanceSecret:config.allowanceSecret,tenantKey:config.tenantKey},readTargetState:async id=>{
    if(!/^tenant_[a-f0-9]{64}$/.test(id))return null;
    const rows=await rest.request('/core_console_state_v3?workspace_id=eq.'+id+'&select=workspace_id,state,version&limit=1');
    if(!Array.isArray(rows)||rows.length!==1||rows[0]?.workspace_id!==id||!Number.isSafeInteger(rows[0].version)||rows[0].version<1)return null;
    return {workspaceId:id,version:rows[0].version,state:rows[0].state};
   }});
  const resolveEmployeeEntitlement=createGoogleEmployeeEntitlementResolver({authService,readProviderIdentity,classify,accountSecret:config.accountSecret,identityRealm:binding.legacyIdentityRealm,fetchImpl,clock});
  const runtime=createCustomerRuntime({config,sessionVerifier,legacyMigrationVerifier,resolveEmployeeEntitlement,fetchImpl,clock});
  const authRoutes=createCustomerAuthRoutes({authService,providerService,customerOrigin:origin,environment:config.environment,issuer:binding.issuer,accountAuth,resolveLoginContext});
  const application=createCustomerApplication({runtime,authRoutes,originConfig:config});
  return Object.freeze({application,nodeHandler:createCustomerNodeAdapter({application,customerOrigin:origin,environment:config.environment})});
 }catch{throw Object.assign(new Error('CUSTOMER_PUBLIC_COMPOSITION_CONFIGURATION_REQUIRED'),{status:503,code:'CUSTOMER_PUBLIC_COMPOSITION_CONFIGURATION_REQUIRED'})}
}
