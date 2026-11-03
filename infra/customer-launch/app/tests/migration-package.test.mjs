import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as inventoryAPI from '../server/migration-inventory.mjs';
import {fixture,realm,providerSnapshot} from './identity-fixture.mjs';
import {SupabaseRest} from '../server/inherited/store.mjs';
import {createReadOnlyMigrationReceiptStore,readVerifiedLegacyBinding} from '../server/inherited/customer-migration-receipts.mjs';
let api={};try{api=await import('../server/migration-package.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
async function prepared(f){const{snapshot}=await providerSnapshot(f.identities,inventoryAPI),out=inventoryAPI.produceSignedLegacyInventory({sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-inventory',signingKey:f.privateKey});return{envelope:out.envelope,inventory:inventoryAPI.verifySignedLegacyInventory({envelope:out.envelope,verificationKey:f.publicKey,stableKeys:f.keys})}}
function restFor(f,drift=false){return new SupabaseRest({url:'https://furfjhymxqsbhvuyeqpx.supabase.co',serviceRoleKey:'fixture-service-role-key',fetcher:async raw=>{const id=new URL(raw).searchParams.get('workspace_id').slice(3),state=JSON.parse(f.files.get(id+'.json'));if(drift)state.memory.push({id:'unexpected-target-change'});return Response.json([{workspace_id:id,version:7,state}])}})}
test('actual reader-compatible signed migration package binds source, backup and independently read target state without copying stable keys',async()=>{
 assert.equal(typeof api.readMigrationTargetBaselines,'function');const f=fixture(),p=await prepared(f),target=await api.readMigrationTargetBaselines({rest:restFor(f),sourceFiles:f.files,environment:'staging'}),out=api.produceSignedLegacyMigrationPackage({inventory:p.inventory,inventoryEnvelope:p.envelope,sourceFiles:f.files,backupFiles:f.backup,targetBaselines:target,signingKey:f.privateKey});
 assert.equal(out.summary.receipts,2);assert.equal(out.summary.missingAllowances,0);assert.equal([...out.files.keys()].some(n=>n.includes('auth-key')||n.includes('allowance-key')||n.includes('tenant-key')),false);
 const directory=await mkdtemp(path.join(os.tmpdir(),'r39-synthetic-migration-'));
 for(const[name,bytes]of out.files){const file=path.join(directory,...name.split('/'));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
 const reader=createReadOnlyMigrationReceiptStore({directory,verificationKey:f.publicKey}),binding=await readVerifiedLegacyBinding(reader,f.identities[0].account);assert.equal(binding.userId,f.identities[0].userId);assert.equal(binding.workspaceEmail,f.identities[0].email);assert.equal(binding.claimKeys.length,2);
});
test('target mutation and unbranded target rows cannot become an import success receipt',async()=>{
 assert.equal(typeof api.readMigrationTargetBaselines,'function');const f=fixture(),p=await prepared(f);
 await assert.rejects(()=>api.readMigrationTargetBaselines({rest:restFor(f,true),sourceFiles:f.files,environment:'staging'}),/MIGRATION_TARGET_STATE_MISMATCH/);
 assert.throws(()=>api.produceSignedLegacyMigrationPackage({inventory:p.inventory,inventoryEnvelope:p.envelope,sourceFiles:f.files,backupFiles:f.backup,targetBaselines:{verified:true},signingKey:f.privateKey}),/VERIFIED_TARGET_BASELINES_REQUIRED/);
});
