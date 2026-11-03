import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHmac,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createConfiguredCoreAuthPool} from '../server/inherited/server/auth/database.mjs';
let api={};try{api=await import('../server/migration-inventory.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
import {realm,fixture,providerSnapshot as snapshotFixture} from './identity-fixture.mjs';
const providerSnapshot=rows=>snapshotFixture(rows,api);
test('complete source/backup and real-reader-shaped provider inventory reconcile all legacy accounts and preserve opaque claims',async()=>{
 assert.equal(typeof api.produceSignedLegacyInventory,'function');const f=fixture(),{snapshot}=await providerSnapshot(f.identities);
 const out=api.produceSignedLegacyInventory({sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-inventory',signingKey:f.privateKey});
 assert.equal(out.summary.legacyAccounts,2);assert.equal(out.summary.claims,4);assert.equal(out.summary.reconciledAccounts,2);assert.equal(out.summary.missingAllowances,0);
 assert.deepEqual(out.envelope.payload.claims,f.registry.customerAccounts.claims);assert.equal(out.envelope.payload.accounts[f.identities[0].account].allowance.used,1);
 const inventory=api.verifySignedLegacyInventory({envelope:out.envelope,verificationKey:f.publicKey,stableKeys:f.keys});assert.equal(api.describeVerifiedLegacyInventory(inventory).legacyAccounts,2);
});
test('source drift, unresolved UUIDs and unbranded provider JSON never become completed migration evidence',async()=>{
 assert.equal(typeof api.produceSignedLegacyInventory,'function');const f=fixture(),{snapshot}=await providerSnapshot(f.identities.slice(0,1));
 const options={sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-inventory',signingKey:f.privateKey};
 assert.throws(()=>api.produceSignedLegacyInventory(options),/LEGACY_IDENTITY_UNRESOLVED/);
 assert.throws(()=>api.produceSignedLegacyInventory({...options,providerInventory:{complete:true,rows:f.identities}}),/PROVIDER_INVENTORY_REQUIRED/);
 const good=await providerSnapshot(f.identities);f.backup.set(f.registryName,Buffer.from('{}'));assert.throws(()=>api.produceSignedLegacyInventory({...options,providerInventory:good.snapshot}),/SOURCE_BACKUP_MISMATCH/);
});
test('missing legacy allowance is recorded as missing and never fabricated or called fresh10',async()=>{
 assert.equal(typeof api.produceSignedLegacyInventory,'function');const f=fixture(),first=f.identities[0],aid='tenant_'+createHmac('sha256',f.keys.allowanceSecret).update('CORE_FREE_ALLOWANCE_V1:'+first.account).digest('hex')+'.json';f.files.delete(aid);f.backup.delete(aid);
 const {snapshot}=await providerSnapshot(f.identities),out=api.produceSignedLegacyInventory({sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-inventory',signingKey:f.privateKey});
 assert.equal(out.summary.missingAllowances,1);assert.deepEqual(out.envelope.payload.accounts[first.account].allowance,{status:'ABSENT_IN_COMPLETE_SOURCE'});assert.equal(f.files.has(aid),false);
});
test('actual R13 tenant binding uses raw32-to-lowercasehex64 UTF8 key rather than raw32 bytes',async()=>{
 const f=fixture(),old=f.keys.tenantKey,raw=Buffer.alloc(32,51);f.keys.tenantKey=raw.toString('hex');f.provenance.tenantKey={file:'tenant-key',encoding:'raw-to-lowercase-hex-utf8'};
 for(const identity of f.identities){const previous='tenant_'+createHmac('sha256',old).update('THE_FA_CUSTOMER_TENANT_V3\0'+identity.email).digest('hex')+'.json',next='tenant_'+createHmac('sha256',f.keys.tenantKey).update('THE_FA_CUSTOMER_TENANT_V3\0'+identity.email).digest('hex')+'.json';const bytes=f.files.get(previous);f.files.delete(previous);f.backup.delete(previous);f.files.set(next,bytes);f.backup.set(next,Buffer.from(bytes));}
 f.files.set('tenant-key',raw);f.backup.set('tenant-key',Buffer.from(raw));const{snapshot}=await providerSnapshot(f.identities);
 const options={sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-tenant-encoding',signingKey:f.privateKey};
 assert.equal(api.produceSignedLegacyInventory(options).summary.reconciledAccounts,2);
 assert.throws(()=>api.produceSignedLegacyInventory({...options,keyProvenance:{...f.provenance,tenantKey:{file:'tenant-key',encoding:'raw'}}}),/STABLE_KEY_PROVENANCE_MISMATCH/);
});
test('actual source directory reader includes hidden originals, leaves bytes unchanged and rejects subdirectories',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'r39-synthetic-snapshot-'));await writeFile(path.join(directory,'.stable-key-fixture'),Buffer.alloc(32,7));await writeFile(path.join(directory,'tenant-fixture.json'),'{}');
 const before=await readFile(path.join(directory,'.stable-key-fixture')),snapshot=await api.readActualR9SnapshotDirectory(directory);assert.equal(snapshot.size,2);assert.deepEqual(snapshot.get('.stable-key-fixture'),before);assert.deepEqual(await readFile(path.join(directory,'.stable-key-fixture')),before);
 await mkdir(path.join(directory,'unexpected-subdirectory'));await assert.rejects(()=>api.readActualR9SnapshotDirectory(directory),/SOURCE_DIRECTORY_INVALID/);
});
test('signed inventory tampering cannot relabel a legacy account or change preserved claims',async()=>{
 const f=fixture(),{snapshot}=await providerSnapshot(f.identities),out=api.produceSignedLegacyInventory({sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-inventory',signingKey:f.privateKey}),tampered=structuredClone(out.envelope);tampered.payload.claims[Object.keys(tampered.payload.claims)[0]]=f.identities[1].account;
 assert.throws(()=>api.verifySignedLegacyInventory({envelope:tampered,verificationKey:f.publicKey,stableKeys:f.keys}),/SIGNED_LEGACY_INVENTORY_INVALID/);
});
