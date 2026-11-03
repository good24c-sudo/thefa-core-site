// Customer per-account storage candidate. Isolated: V3 schema is not deployed.
import { createHmac, createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SupabaseRest, SupabaseStateStore, SupabaseArtifactStorage } from './store.mjs';

const clone = value => structuredClone(value);
const failure = (status, code) => Object.assign(new Error(code), { status, code });
const sha256 = content => createHash('sha256').update(content).digest('hex');
const WORKSPACE = /^tenant_[a-f0-9]{64}$/;
const STATE = () => ({ version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{} });
function safeState(value) {
  if (value == null) return STATE();
  if (value.version !== 2 || !Array.isArray(value.tasks) || !Array.isArray(value.artifacts)
      || !Array.isArray(value.receipts) || !Array.isArray(value.memory)
      || !value.idempotency || typeof value.idempotency !== 'object'
      || Array.isArray(value.idempotency)) throw failure(503,'TENANT_STATE_INVALID');
  return clone(value);
}
function safeVersion(value) {
  const n=Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) throw failure(503,'TENANT_VERSION_INVALID');
  return n;
}
function safeWorkspace(workspace) {
  if (typeof workspace!=='string' || !WORKSPACE.test(workspace)) throw failure(400,'TENANT_WORKSPACE_INVALID');
  return workspace;
}
function safeArtifact(name) {
  if(typeof name!=='string'||!/^[a-zA-Z0-9_-]{1,180}\.md$/.test(name))throw failure(400,'TENANT_ARTIFACT_PATH_INVALID');
}
export function tenantWorkspaceForEmail(email, tenantKey) {
  if(typeof email!=='string' || email!==email.trim().toLowerCase()
      || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof tenantKey!=='string'||tenantKey.length<32) throw failure(503,'TENANT_BINDING_NOT_READY');
  // Dedicated stable tenant key: NEVER reuse/rotate the OTP signing secret for account identifiers.
  return 'tenant_'+createHmac('sha256',tenantKey).update('THE_FA_CUSTOMER_TENANT_V3\0'+email,'utf8').digest('hex');
}

export class TenantStateStore extends SupabaseStateStore {
  constructor(rest,{workspaceId,owner=randomUUID()}={}) {
    super(rest,{owner});this.workspaceId=safeWorkspace(workspaceId);
  }
  async init() {
    const rows=await this.rest.request('/core_console_state_v3?workspace_id=eq.'+this.workspaceId+'&select=state,version,lease_owner,lease_until&limit=1');
    if(!Array.isArray(rows))throw failure(503,'TENANT_SNAPSHOT_INVALID');
    this.state=safeState(rows[0]?.state);this.version=safeVersion(rows[0]?.version);
  }
  async acquire() {
    if(this.closed)throw failure(409,'TENANT_STORE_CLOSED');
    const r=await this.rest.rpc('core_console_acquire_lease_v3',{p_workspace:this.workspaceId,p_owner:this.owner,p_seconds:120});
    if(r?.granted===false)throw failure(409,'LEASE_BUSY');
    if(r?.granted!==true||r.lease_owner!==this.owner)throw failure(503,'TENANT_LEASE_UNVERIFIED');
    this.hasLease=true;return r;
  }
  mutate(fn) {
    const task=this.queue.then(async()=>{
      const lease=await this.acquire();
      const draft=safeState(lease.state);const version=safeVersion(lease.version);
      if(lease.recovered)for(const item of draft.tasks)if(['RUNNING','QUEUED'].includes(item.status)){
        item.status='PAUSED';item.error='EXPIRED_TENANT_WRITER_RECOVERY';item.updatedAt=new Date().toISOString();
        item.events.push({id:'event_'+randomUUID(),at:item.updatedAt,status:'PAUSED',message:'만료된 writer 복구. Job은 다시 만들지 않습니다.'});
      }
      const out=await fn(draft);
      const result=await this.rest.rpc('core_console_save_state_v3',{
        p_workspace:this.workspaceId,p_owner:this.owner,p_expected_version:version,p_state:draft});
      this.version=safeVersion(result?.version);this.state=draft;this.onChange?.();
      return clone(out);
    });
    this.queue=task.catch(()=>{});
    return task;
  }
  async close() {
    if(this.closed)return;
    await this.queue;
    if(this.hasLease&&!this.state.tasks.some(item=>['RUNNING','QUEUED'].includes(item.status)))
      await this.rest.rpc('core_console_release_lease_v3',{p_workspace:this.workspaceId,p_owner:this.owner});
    this.closed=true;
  }
}

export class TenantArtifactStorage extends SupabaseArtifactStorage {
  constructor(rest,store){super(rest,store);this.workspaceId=safeWorkspace(store.workspaceId);}
  async read(name) {
    safeArtifact(name);
    const rows=await this.rest.request('/core_console_artifacts_v3?workspace_id=eq.'+this.workspaceId+'&name=eq.'+encodeURIComponent(name)+'&select=name,content,sha256&limit=1');
    if(!Array.isArray(rows))throw failure(503,'TENANT_ARTIFACT_QUERY_INVALID');
    const item=rows[0];
    if(!item)throw failure(404,'TENANT_ARTIFACT_NOT_FOUND');
    if(typeof item.content!=='string'||sha256(item.content)!==item.sha256)throw failure(409,'TENANT_ARTIFACT_HASH_MISMATCH');
    return item.content;
  }
  async write(name,content) {
    safeArtifact(name);
    if(typeof content!=='string'||Buffer.byteLength(content)>64000)throw failure(400,'TENANT_ARTIFACT_CONTENT_INVALID');
    await this.store.ensureLease();
    if(!this.directory)throw failure(503,'TENANT_ARTIFACT_STORAGE_UNINITIALIZED');
    const file=path.join(this.directory,name),temp=file+'.'+randomUUID()+'.tmp';
    let temporaryCreated=false;
    try{
      const handle=await fs.open(temp,'wx',0o600);temporaryCreated=true;
      try{await handle.writeFile(content,'utf8');await handle.sync();}finally{await handle.close();}
      const hash=sha256(await fs.readFile(temp));
      const written=await this.rest.rpc('core_console_put_artifact_v3',{
        p_workspace:this.workspaceId,p_owner:this.store.owner,p_name:name,p_content:content,p_sha256:hash});
      if(written?.sha256!==hash||written.name!==name)throw failure(409,'TENANT_ARTIFACT_PERSISTENCE_MISMATCH');
      // Only a confirmed durable write may replace the local committed file.
      await fs.rename(temp,file);temporaryCreated=false;
    }finally{
      if(temporaryCreated)try{await fs.unlink(temp);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
}

export function createTenantCloudPersistence({email,tenantKey,url,serviceRoleKey,rest,owner}={}) {
  const workspaceId=tenantWorkspaceForEmail(email,tenantKey);
  const transport=rest||new SupabaseRest({url,serviceRoleKey});
  const store=new TenantStateStore(transport,{workspaceId,owner});
  return {store,artifactStorage:new TenantArtifactStorage(transport,store)};
}
