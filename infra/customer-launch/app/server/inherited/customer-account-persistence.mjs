import {createHash} from 'node:crypto';
import {TenantStateStore,tenantWorkspaceForEmail} from './customer-tenant-storage.mjs';
import {SupabaseRest} from './store.mjs';
import {assertTenantEnvelope} from './cloud-allowance.mjs';

const registryId='tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex');
const failure=code=>Object.assign(new Error(code),{status:503,code});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const readers=new WeakMap();
function assertRegistry(state){
 if(!plain(state?.customerAccounts)||!['flows','sessions','accounts','claims','attempts'].every(key=>plain(state.customerAccounts[key])))
  throw failure('ACCOUNT_REGISTRY_IMPORT_REQUIRED');
}
class ImportedAccountRegistryStore extends TenantStateStore{
 async init(){await super.init();assertRegistry(this.state)}
 mutate(fn){return super.mutate(state=>{assertRegistry(state);return fn(state)})}
}

/** Server-only adapter for the existing V3 tenant row lease and CAS contract.
 * The global account registry must already be imported; absence never becomes
 * an empty registry, a new identity, or a fresh free-use balance.
 */
export function createCustomerAccountPersistence({rest,tenantKey}={}){
 if(typeof rest?.request!=='function'||typeof rest?.rpc!=='function'||typeof tenantKey!=='string'||tenantKey.length<32)
  throw failure('ACCOUNT_PERSISTENCE_CONFIGURATION_REQUIRED');
 return Object.freeze({
  registry(id){if(id!==registryId)throw failure('ACCOUNT_REGISTRY_SCOPE_INVALID');return new ImportedAccountRegistryStore(rest,{workspaceId:registryId})},
  workspace(email){return new TenantStateStore(rest,{workspaceId:tenantWorkspaceForEmail(email,tenantKey)})}
 });
}

/** A branded read-only capability constructed from server configuration. Its brand
 * proves factory origin, not provider authentication or an import/authority receipt.
 * fetchImpl is a trusted server dependency; fixtures must label their transport.
 */
export function createReadOnlyCustomerAccountRegistry({environment,supabaseUrl,serviceRoleKey,fetchImpl=globalThis.fetch}={}){
 const projects={staging:'furfjhymxqsbhvuyeqpx',production:'cgrppxfdurpzzfvkmfte'};
 if(!Object.hasOwn(projects,environment)||supabaseUrl!=='https://'+projects[environment]+'.supabase.co'||
   typeof serviceRoleKey!=='string'||!/^\S{16,8192}$/.test(serviceRoleKey)||/[^\x21-\x7e]/.test(serviceRoleKey)||typeof fetchImpl!=='function')
  throw failure('ACCOUNT_REGISTRY_CONFIGURATION_REQUIRED');
 const rest=new SupabaseRest({url:supabaseUrl,serviceRoleKey,fetcher:fetchImpl});Object.freeze(rest);
 const reader=Object.freeze({});
 readers.set(reader,async()=>{
  const rows=await rest.request('/core_console_state_v3?workspace_id=eq.'+registryId+'&select=workspace_id,state,version&limit=1');
  if(!Array.isArray(rows)||rows.length!==1||!plain(rows[0])||rows[0].workspace_id!==registryId||!Number.isSafeInteger(rows[0].version)||rows[0].version<1)
   throw failure('ACCOUNT_REGISTRY_SNAPSHOT_INVALID');
  assertTenantEnvelope(rows[0].state);assertRegistry(rows[0].state);
  return structuredClone({workspaceId:registryId,version:rows[0].version,state:rows[0].state});
 });
 return reader;
}
export const isReadOnlyCustomerAccountRegistry=reader=>readers.has(reader);
export async function readCustomerAccountRegistrySnapshot(reader){
 const read=readers.get(reader);if(!read)throw failure('ACCOUNT_REGISTRY_READER_REQUIRED');return read();
}
