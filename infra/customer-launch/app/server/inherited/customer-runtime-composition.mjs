import {SupabaseRest} from './store.mjs';
import {createIsolatedCloudAllowance} from './cloud-allowance.mjs';
import {createIsolatedDailyAiBudget} from './daily-ai-budget.mjs';
import {createCustomerDeepSeekProvider} from './customer-deepseek-provider.mjs';
import {createCustomerHttpAdapter} from './customer-http-adapter.mjs';
import {validateCustomerOrigin} from './customer-origin-policy.mjs';

const invalid=()=>{throw new Error('INVALID_CONFIGURATION')};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

// Never infer an encoding, generate keys, or reuse one ledger's key for another.
function stableSecret(config,name){
 const bytes=config[name],base64=config[name+'Base64'];
 if(bytes!==undefined&&base64===undefined&&Buffer.isBuffer(bytes)&&bytes.length===32)
  return Buffer.from(bytes);
 if(bytes===undefined&&typeof base64==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(base64)){
  const decoded=Buffer.from(base64,'base64');
  if(decoded.length===32&&decoded.toString('base64')===base64)return decoded;
 }
 invalid();
}

/**
 * Explicit server configuration only; construction performs no I/O.
 * Required config: customerOrigin, environment, supabaseUrl, serviceRoleKey,
 * tenantKey, deepseekApiKey, and separate allowanceSecret/budgetSecret Buffers
 * (32 bytes) or their explicit canonical ...SecretBase64 string alternatives.
 * Callers supply trusted session and, for legacy users, migration verifiers.
 * This factory deliberately does not activate the default public API binding.
 */
export function createCustomerRuntime(options={}){
 try{
  if(!object(options))invalid();
  const {config,sessionVerifier,legacyMigrationVerifier,resolveEmployeeEntitlement, 
   fetchImpl=globalThis.fetch?.bind(globalThis),clock=Date.now}=options;
  if(!object(config)||typeof sessionVerifier!=='function'||
   (legacyMigrationVerifier!==undefined&&typeof legacyMigrationVerifier!=='function')||
   (resolveEmployeeEntitlement!==undefined&&typeof resolveEmployeeEntitlement!=='function')||
   typeof fetchImpl!=='function'||typeof clock!=='function')invalid();
  const {customerOrigin,environment,supabaseUrl,serviceRoleKey,tenantKey,deepseekApiKey}=config;
  if(typeof customerOrigin!=='string'||typeof environment!=='string')invalid();
  const origin=validateCustomerOrigin({customerOrigin,environment});
  if(typeof supabaseUrl!=='string')invalid();
  const database=new URL(supabaseUrl);
  if(database.protocol!=='https:'||database.username||database.password||database.port||
   database.search||database.hash||database.pathname!=='/'||
   !/^[a-z0-9-]+\.supabase\.co$/.test(database.hostname)||
   ![database.origin,database.origin+'/'].includes(supabaseUrl))invalid();
  if(typeof serviceRoleKey!=='string'||!/^\S{16,8192}$/.test(serviceRoleKey)||
   /[^\x21-\x7e]/.test(serviceRoleKey)||typeof tenantKey!=='string'||
   tenantKey.length<32||tenantKey.length>8192||tenantKey!==tenantKey.trim())invalid();
  const allowanceSecret=stableSecret(config,'allowanceSecret');
  const budgetSecret=stableSecret(config,'budgetSecret');
  const rest=new SupabaseRest({url:database.origin,serviceRoleKey,fetcher:fetchImpl});
  const allowance=createIsolatedCloudAllowance({rest,secret:allowanceSecret,usageEpoch:config.accountMode==='fresh-launch'?config.usageEpoch:null});
  const budget=createIsolatedDailyAiBudget({rest,secret:budgetSecret,clock});
  const provider=createCustomerDeepSeekProvider({apiKey:deepseekApiKey,fetchImpl,
   model:'deepseek-flash',maxTokens:1024});
  const handler=createCustomerHttpAdapter({sessionVerifier,legacyMigrationVerifier,resolveEmployeeEntitlement,
   rest,tenantKey,allowance,budget,provider},{customerOrigin:origin,environment});
  return Object.freeze({handler});
 }catch{
  // Do not attach cause/config/provider errors: they may contain server secrets.
  throw Object.assign(new Error('CUSTOMER_RUNTIME_CONFIGURATION_INVALID'),{
   status:503,code:'CUSTOMER_RUNTIME_CONFIGURATION_INVALID'
  });
 }
}
