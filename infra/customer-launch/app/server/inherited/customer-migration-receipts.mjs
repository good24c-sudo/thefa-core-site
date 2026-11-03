import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,createPublicKey,verify,KeyObject} from 'node:crypto';
import {assertTenantEnvelope,inspectAllowance,allowanceWorkspaceForAccount} from './cloud-allowance.mjs';
import {tenantWorkspaceForEmail} from './customer-tenant-storage.mjs';

const HASH=/^[a-f0-9]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE=/^tenant_[a-f0-9]{64}$/;
const readers=new WeakSet(),records=new WeakMap();
const invalid=()=>{throw Object.assign(new Error('CUSTOMER_MIGRATION_CONFIGURATION_INVALID'),{code:'CUSTOMER_MIGRATION_CONFIGURATION_INVALID'})};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const email=x=>typeof x==='string'&&x.length<=254&&x===x.trim().toLowerCase()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const realm=x=>typeof x==='string'&&/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/core-customer-auth$/.test(x);
function canonical(x,depth=0){
 if(depth>40)throw Error('INVALID_SNAPSHOT');
 if(x===null||typeof x==='boolean'||typeof x==='string'||(typeof x==='number'&&Number.isFinite(x)))return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(v=>canonical(v,depth+1)).join(',')+']';
 if(!plain(x))throw Error('INVALID_SNAPSHOT');
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k],depth+1)).join(',')+'}';
}
const digest=x=>sha(Buffer.from(canonical(x)));
function unavailable(){return Object.assign(new Error('CUSTOMER_MIGRATION_VERIFICATION_UNAVAILABLE'),{code:'CUSTOMER_MIGRATION_VERIFICATION_UNAVAILABLE'})}

// Dedicated trusted snapshot directories only. No mkdir, create, key-file reads or writes.
async function readSnapshot(directory,parts,limit=4*1024*1024){
 const root=path.resolve(directory),resolved=await realpath(root);
 if(resolved!==root)throw Error('SNAPSHOT_DIRECTORY_ALIAS');
 let file=root;
 for(const part of parts){
  if(!/^[a-zA-Z0-9_.-]+$/.test(part)||part==='.'||part==='..')throw Error('SNAPSHOT_PATH_INVALID');
  file=path.join(file,part);const info=await lstat(file);if(info.isSymbolicLink())throw Error('SNAPSHOT_LINK_FORBIDDEN');
 }
 const before=await lstat(file);if(!before.isFile()||before.size>limit)throw Error('SNAPSHOT_INVALID');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.dev!==before.dev||stat.ino!==before.ino||stat.size>limit)throw Error('SNAPSHOT_CHANGED');
  const chunks=[];let total=0;
  for(;;){const buffer=Buffer.alloc(Math.min(65536,limit+1-total)),{bytesRead}=await handle.read(buffer);if(!bytesRead)break;total+=bytesRead;if(total>limit)throw Error('SNAPSHOT_OVERSIZED');chunks.push(buffer.subarray(0,bytesRead));}
  return Buffer.concat(chunks);
 }finally{await handle.close()}
}
function validPayload(p,accountId){
 return plain(p)&&p.contract==='THEFA_LEGACY_MIGRATION_RECEIPT_V1'&&p.accountId===accountId&&
  typeof p.migrationId==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(p.migrationId)&&
  plain(p.identity)&&UUID.test(p.identity.userId??'')&&['google','kakao'].includes(p.identity.provider)&&realm(p.identity.backendUrl)&&email(p.identity.workspaceEmail)&&HASH.test(p.identity.registrySha256??'')&&
  plain(p.keyHashes)&&['accountSecret','allowanceSecret','tenantKey'].every(k=>HASH.test(p.keyHashes[k]??''))&&
  ['workspace','allowance'].every(kind=>plain(p[kind])&&WORKSPACE.test(p[kind].workspaceId??'')&&HASH.test(p[kind].sourceSha256??'')&&HASH.test(p[kind].baselineSha256??'')&&Number.isSafeInteger(p[kind].targetVersion)&&p[kind].targetVersion>=1);
}
function preservedTree(before,after){
 if(Array.isArray(before))return Array.isArray(after)&&after.length>=before.length&&before.every((value,index)=>preservedTree(value,after[index]));
 if(plain(before))return plain(after)&&Object.keys(before).every(key=>Object.hasOwn(after,key)&&preservedTree(before[key],after[key]));
 return canonical(before)===canonical(after);
}
function unchangedFields(before,after,mutable){
 return plain(after)&&Object.keys(before).filter(key=>!mutable.has(key)).every(key=>Object.hasOwn(after,key)&&canonical(before[key])===canonical(after[key]));
}
const text=(value,min,max)=>typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const uniqueIds=items=>Array.isArray(items)&&items.every(item=>plain(item)&&typeof item.id==='string')&&new Set(items.map(item=>item.id)).size===items.length;
function preservedSettings(before,after){
 if(!plain(before)||!plain(after)||!unchangedFields(before,after,new Set(['aiTier','route','ava']))||
  !['AUTO','STANDARD','EXPERT','ULTRA'].includes(after.aiTier)||!['AUTO','LOCAL_FIRST','LOCAL_ONLY','CLOUD_FIRST'].includes(after.route))return false;
 const old=before.ava,current=after.ava;
 if(old==null&&current==null)return true;
 if(!plain(current)||current.version!=='AVA_V1_DRAFT')return false;
 const fields=new Map([['role',80],['memoryScope',160],['permissions',160],['budget',160],['instructions',2000]]);
 if(plain(old)&&!unchangedFields(old,current,new Set(fields.keys())))return false;
 for(const [key,max]of fields){
  if(plain(old)&&Object.hasOwn(old,key)&&!Object.hasOwn(current,key))return false;
  if(Object.hasOwn(current,key)&&!text(current[key],key==='instructions'?0:1,max))return false;
 }
 return true;
}
function preservedWorkspace(before,after){
 // Existing customer reducers have no delete/rewrite operation for original messages,
 // projects or conversations. They update metadata, archive and append new records.
 for(const key of Object.keys(before))if(key!=='customerChat'&&!preservedTree(before[key],after[key]))return false;
 const old=before.customerChat,live=after.customerChat;if(old==null)return true;
 if(!plain(old)||!plain(live)||old.version!==1||live.version!==1||!uniqueIds(old.projects)||!uniqueIds(live.projects)||!uniqueIds(old.conversations)||!uniqueIds(live.conversations))return false;
 if(!preservedSettings(old.settings,live.settings))return false;
 const projects=new Map(live.projects.map(item=>[item.id,item])),conversations=new Map(live.conversations.map(item=>[item.id,item]));
 for(const item of live.projects)if(!/^proj_[0-9a-f-]{36}$/.test(item.id)||!text(item.title,1,80)||!text(item.instructions,0,2000)||!time(item.createdAt)||!time(item.updatedAt))return false;
 for(const item of old.projects)if(!projects.has(item.id)||!unchangedFields(item,projects.get(item.id),new Set(['title','instructions','updatedAt'])))return false;
 for(const item of live.conversations){
  if(!/^chat_[0-9a-f-]{36}$/.test(item.id)||!text(item.title,1,100)||(item.projectId!==null&&!projects.has(item.projectId))||!time(item.createdAt)||!time(item.updatedAt)||
   (item.archivedAt!==null&&!time(item.archivedAt))||!uniqueIds(item.messages)||item.messages.length>160)return false;
 }
 for(const item of old.conversations){
  const current=conversations.get(item.id);
  if(!current||!unchangedFields(item,current,new Set(['title','projectId','updatedAt','archivedAt','messages']))||current.messages.length<item.messages.length||
   (item.archivedAt!==null&&current.archivedAt!==item.archivedAt))return false;
  for(let index=0;index<item.messages.length;index++){
   const original=item.messages[index],message=current.messages[index];
   if(!unchangedFields(original,message,new Set(['state']))||
    (original.state!==message.state&&!(original.role==='user'&&original.state==='MODEL_REQUEST_PENDING'&&['SENT_TO_MODEL','MODEL_REQUEST_PAUSED'].includes(message.state))))return false;
  }
 }
 // Preserve nonmutable imported extension fields; reducer settings and metadata keys
 // may change/prune. Durable turn identities survive their permitted phase progression.
 for(const key of Object.keys(old))if(!['projects','conversations','settings','idempotency','turnRequests'].includes(key)&&!preservedTree(old[key],live[key]))return false;
 if(!plain(old.idempotency)||!plain(live.idempotency))return false;
 for(const [id,entry]of Object.entries(old.idempotency)){
  // Exact rule used by the existing reducer: only completed metadata keys older
  // than 24h (or invalid legacy timestamps) may be pruned; retained entries stay exact.
  if(Object.hasOwn(live.idempotency,id)){if(canonical(entry)!==canonical(live.idempotency[id]))return false;}
  else{const at=Date.parse(entry?.createdAt??'');if(Number.isFinite(at)&&at>=Date.now()-86400000)return false;}
 }
 for(const [id,entry]of Object.entries(old.turnRequests??{})){
  const current=live.turnRequests?.[id];
  if(!current||!unchangedFields(entry,current,new Set(['phase','updatedAt','assistantMessageId']))||
   (entry.assistantMessageId!==null&&entry.assistantMessageId!==current.assistantMessageId)||
   (entry.phase!==current.phase&&!(entry.phase==='MODEL_REQUEST_PENDING'&&['MODEL_RESPONSE_RECEIVED_UNVERIFIED','MODEL_REQUEST_PAUSED'].includes(current.phase))))return false;
 }
 return true;
}

/** An operator-signed offline migration snapshot, not a grant issuer or importer.
 * verificationKey is an independently provisioned trusted Ed25519 PUBLIC key.
 * A JSON flag, payload hash or self-supplied receipt callback cannot enter this trust boundary.
 */
export function createReadOnlyMigrationReceiptStore({directory,verificationKey}={}){
 let key;
 try{key=verificationKey instanceof KeyObject?verificationKey:createPublicKey(verificationKey)}catch{invalid()}
 if(typeof directory!=='string'||!path.isAbsolute(directory)||key.type!=='public'||key.asymmetricKeyType!=='ed25519')invalid();
 const readTrustedReceipt=async accountId=>{
  if(!HASH.test(accountId??''))return null;
  try{
   const bytes=await readSnapshot(directory,['receipts',accountId+'.json'],65536),envelope=JSON.parse(bytes.toString('utf8'));
   if(!plain(envelope)||!validPayload(envelope.payload,accountId)||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))return null;
   const signature=Buffer.from(envelope.signature,'base64');
   if(signature.length!==64||signature.toString('base64')!==envelope.signature||!verify(null,Buffer.from(canonical(envelope.payload)),key,signature))return null;
   const p=envelope.payload,snapshots={};
   for(const kind of ['workspace','allowance']){
    const id=p[kind].workspaceId,source=await readSnapshot(directory,['source',id+'.json']),backup=await readSnapshot(directory,['backup',id+'.json']),baseline=await readSnapshot(directory,['target-baseline',id+'.json']);
    if(sha(source)!==p[kind].sourceSha256||!source.equals(backup)||sha(baseline)!==p[kind].baselineSha256)return null;
    const sourceState=JSON.parse(source.toString('utf8')),baselineState=JSON.parse(baseline.toString('utf8'));
    assertTenantEnvelope(sourceState);assertTenantEnvelope(baselineState);
    if(canonical(sourceState)!==canonical(baselineState))return null;
    snapshots[kind]={sourceState,baselineState};
   }
   // Authenticate an immutable identity snapshot separately from the live shared
   // registry. Other accounts legitimately change its flows/sessions/refresh data.
   const identity=await readLegacyRegistrySnapshot(path.join(directory,'identity-snapshot'));
   if(identity.sha256!==p.identity.registrySha256||identity.state.customerAccounts.accounts[accountId]?.workspaceEmail!==p.identity.workspaceEmail||!plain(identity.state.customerAccounts.claims))return null;
   const record=Object.freeze({accountId,receiptSha256:sha(bytes)});
   records.set(record,{payload:p,snapshots,identity:identity.state.customerAccounts});return record;
  }catch{return null}
 };
 readers.add(readTrustedReceipt);return readTrustedReceipt;
}

// Used by the read-only R13 registry resolver. Only authenticated factory readers qualify.
export async function readVerifiedLegacyBinding(readTrustedReceipt,accountId){
 if(!readers.has(readTrustedReceipt))return null;
 const record=await readTrustedReceipt(accountId),data=records.get(record);
 return data?structuredClone({accountId:record.accountId,...data.payload.identity,keyHashes:data.payload.keyHashes,
  claimKeys:Object.entries(data.identity.claims).filter(([,owner])=>owner===accountId).map(([key])=>key)}):null;
}
export async function readLegacyRegistrySnapshot(directory){
 const registryId='tenant_'+sha('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1');
 const bytes=await readSnapshot(directory,[registryId+'.json']);
 const state=JSON.parse(bytes.toString('utf8'));assertTenantEnvelope(state);
 if(!plain(state.customerAccounts)||!plain(state.customerAccounts.accounts)||!plain(state.customerAccounts.sessions))throw Error('LEGACY_REGISTRY_INVALID');
 return{state,sha256:sha(bytes)};
}

/** Read independently authenticated import baseline and current server DB snapshots.
 * No key generation, DB writes, import, fresh allowance, or caller attestation flags.
 */
export function createLegacyMigrationVerifier({readTrustedReceipt,readTargetState,stableKeyProvenance}={}){
 const k=stableKeyProvenance;
 if(!readers.has(readTrustedReceipt)||typeof readTargetState!=='function'||!plain(k)||!realm(k.backendUrl)||
  !Buffer.isBuffer(k.accountSecret)||k.accountSecret.length!==32||!Buffer.isBuffer(k.allowanceSecret)||k.allowanceSecret.length!==32||typeof k.tenantKey!=='string'||k.tenantKey.length<32)invalid();
 const keys={backendUrl:k.backendUrl,accountSecret:Buffer.from(k.accountSecret),allowanceSecret:Buffer.from(k.allowanceSecret),tenantKey:k.tenantKey};
 return async accountId=>{
  if(!HASH.test(accountId??''))return null;
  const record=await readTrustedReceipt(accountId),data=records.get(record);if(!data)return null;
  const {payload:p,snapshots}=data;
  try{
   if(p.identity.backendUrl!==keys.backendUrl||['accountSecret','allowanceSecret','tenantKey'].some(name=>p.keyHashes[name]!==sha(name==='tenantKey'?Buffer.from(keys[name]):keys[name]))||
    createHmac('sha256',keys.accountSecret).update(keys.backendUrl+'|'+p.identity.userId).digest('hex')!==accountId||
    tenantWorkspaceForEmail(p.identity.workspaceEmail,keys.tenantKey)!==p.workspace.workspaceId||allowanceWorkspaceForAccount(accountId,keys.allowanceSecret)!==p.allowance.workspaceId)return null;
   for(const kind of ['sourceState','baselineState'])inspectAllowance(snapshots.allowance[kind].customerAllowance,{allowMissing:false,secret:keys.allowanceSecret});
  }catch{return null}
  let workspace,current;
  try{workspace=await readTargetState(p.workspace.workspaceId);current=await readTargetState(p.allowance.workspaceId)}catch{throw unavailable()}
  try{
   for(const [row,kind]of [[workspace,'workspace'],[current,'allowance']]){
    if(!plain(row)||row.workspaceId!==p[kind].workspaceId||!Number.isSafeInteger(row.version)||row.version<p[kind].targetVersion)return null;
    assertTenantEnvelope(row.state);
    if(row.version===p[kind].targetVersion&&canonical(row.state)!==canonical(snapshots[kind].baselineState))return null;
   }
   if(!preservedWorkspace(snapshots.workspace.baselineState,workspace.state))return null;
   const base=snapshots.allowance.baselineState.customerAllowance,live=current.state.customerAllowance;
   const before=inspectAllowance(base,{allowMissing:false,secret:keys.allowanceSecret}),now=inspectAllowance(live,{allowMissing:false,secret:keys.allowanceSecret});
   if(now.used<before.used)return null;
   // Signed exact import baseline stays immutable. Legitimate later usage may advance,
   // but cannot remove original succeeded/reserved requests or change pending completion data.
   for(const [id,status]of Object.entries(base.requests)){
    if(status==='SUCCEEDED'?live.requests[id]!=='SUCCEEDED':!['RESERVED','SUCCEEDED'].includes(live.requests[id]))return null;
    if(status==='RESERVED'&&live.requests[id]==='RESERVED'&&base.completions?.[id]&&canonical(base.completions[id])!==canonical(live.completions?.[id]??null))return null;
   }
   const sourceLedgerSha256=digest(snapshots.allowance.sourceState.customerAllowance),targetLedgerSha256=digest(base);
   if(sourceLedgerSha256!==targetLedgerSha256)return null;
   return Object.freeze({accountId,exactBackupAndTargetVerified:true,targetLedgerExists:true,receiptSha256:record.receiptSha256,sourceLedgerSha256,targetLedgerSha256});
  }catch{return null}
 };
}
