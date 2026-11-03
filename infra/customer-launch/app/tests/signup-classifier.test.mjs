import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import * as inventoryAPI from '../server/migration-inventory.mjs';
import {fixture,realm,providerSnapshot,authenticatedIdentity} from './identity-fixture.mjs';
import {createConfiguredCustomerAuthService} from '../server/inherited/server/auth/service.mjs';
import {createConfiguredCoreAuthPool} from '../server/inherited/server/auth/database.mjs';
import {createCustomerAccountPersistence} from '../server/inherited/customer-account-persistence.mjs';
import {FakeLeaseDatabase} from './fake-lease-database.mjs';
let api={};try{api=await import('../server/signup-classifier.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
const origin='https://thefa-core-customer-r39.vercel.app';
async function prepare(f){const {snapshot}=await providerSnapshot(f.identities,inventoryAPI);const out=inventoryAPI.produceSignedLegacyInventory({sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'isolated-r39-inventory',signingKey:f.privateKey});return inventoryAPI.verifySignedLegacyInventory({envelope:out.envelope,verificationKey:f.publicKey,stableKeys:f.keys})}
test('signup classification uses actual-session/DB reader proof and complete signed legacy subject inventory',async()=>{
 assert.equal(typeof api.createVerifiedProviderIdentityReader,'function');const f=fixture(),inventory=await prepare(f),classify=api.createSignupClassifier({inventory,stableKeys:f.keys});
 const old=await authenticatedIdentity(f,f.identities[0]),classified=classify(old.proof);assert.equal(api.readSignupClassification(classified).kind,'LEGACY');assert.equal(api.readSignupClassification(classified).principalId,f.identities[0].account);
 const fresh=await authenticatedIdentity(f,{userId:'33333333-3333-4333-8333-333333333333',provider:'google',subject:'fixture-genuinely-unmapped-subject'}),newClass=classify(fresh.proof);assert.equal(api.readSignupClassification(newClass).kind,'NEW_REQUIRES_ATOMIC_REGISTRATION');
 assert.throws(()=>classify({verified:true,userId:'33333333-3333-4333-8333-333333333333',provider:'google'}),/VERIFIED_PROVIDER_IDENTITY_REQUIRED/);
 const rebound=await authenticatedIdentity(f,{...f.identities[0],userId:'44444444-4444-4444-8444-444444444444'});assert.throws(()=>classify(rebound.proof),/ACCOUNT_IDENTITY_REBIND_REQUIRES_RECONCILIATION/);
});
test('source allowance without registry UUID mapping blocks a new balance despite otherwise complete inventory',async()=>{
 assert.equal(typeof api.createSignupClassifier,'function');const f=fixture(),row={userId:'33333333-3333-4333-8333-333333333333',provider:'google',subject:'fixture-unclassified-subject'},id=createHmac('sha256',f.keys.accountSecret).update(realm+'|'+row.userId).digest('hex'),aid='tenant_'+createHmac('sha256',f.keys.allowanceSecret).update('CORE_FREE_ALLOWANCE_V1:'+id).digest('hex')+'.json';
 const bytes=Buffer.from(JSON.stringify({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{},customerAllowance:{version:1,used:0,requests:{},completions:{}}}));f.files.set(aid,bytes);f.backup.set(aid,Buffer.from(bytes));
 const inventory=await prepare(f),proof=await authenticatedIdentity(f,row);assert.throws(()=>api.createSignupClassifier({inventory,stableKeys:f.keys})(proof.proof),/UNCLASSIFIED_SOURCE_RECORD_REQUIRES_RECONCILIATION/);
});
test('atomic new registration preserves old accounts/claims and repeated sign-in does not allocate another account',async()=>{
 assert.equal(typeof api.createSignupAccountAdmission,'function');const f=fixture(),inventory=await prepare(f),newProof=await authenticatedIdentity(f,{userId:'33333333-3333-4333-8333-333333333333',provider:'google',subject:'fixture-new-subject'}),classification=api.createSignupClassifier({inventory,stableKeys:f.keys})(newProof.proof),db=new FakeLeaseDatabase(),registryId='tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex');
 db.prime(registryId,JSON.parse(f.files.get(f.registryName)));const persistence=createCustomerAccountPersistence({rest:db,tenantKey:f.keys.tenantKey}),admit=api.createSignupAccountAdmission({inventory,persistence,accountSecret:f.keys.accountSecret});
 const first=await admit(classification),again=await admit(classification);assert.equal(first.principalId,again.principalId);assert.equal(first.accountProvenance,'NEW_ACCOUNT_CONFIRMED');assert.equal(Object.keys(db.rows.get(registryId).state.customerAccounts.accounts).length,3);
 for(const[id,record]of Object.entries(f.registry.customerAccounts.accounts))assert.deepEqual(db.rows.get(registryId).state.customerAccounts.accounts[id],record);
 for(const[key,id]of Object.entries(f.registry.customerAccounts.claims))assert.equal(db.rows.get(registryId).state.customerAccounts.claims[key],id);
 assert.equal(db.rows.size,1);assert.equal(db.rows.get(registryId).owner,null);
});
test('lost registration reply never auto-retries and a later fresh read retains the committed account',async()=>{
 const f=fixture(),inventory=await prepare(f),proof=await authenticatedIdentity(f,{userId:'33333333-3333-4333-8333-333333333333',provider:'google',subject:'fixture-lost-reply-subject'}),classification=api.createSignupClassifier({inventory,stableKeys:f.keys})(proof.proof),db=new FakeLeaseDatabase(),registryId='tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex');db.prime(registryId,JSON.parse(f.files.get(f.registryName)));const admit=api.createSignupAccountAdmission({inventory,persistence:createCustomerAccountPersistence({rest:db,tenantKey:f.keys.tenantKey}),accountSecret:f.keys.accountSecret});
 db.failNextSave='after';await assert.rejects(()=>admit(classification));assert.equal(db.calls.filter(x=>x.op==='core_console_save_state_v3').length,1);assert.equal(Object.keys(db.rows.get(registryId).state.customerAccounts.accounts).length,3);
 const later=await admit(classification);assert.equal(later.accountProvenance,'NEW_ACCOUNT_CONFIRMED');assert.equal(Object.keys(db.rows.get(registryId).state.customerAccounts.accounts).length,3);assert.equal(db.rows.size,1);
});
test('a missing preserved legacy claim blocks new registration and cannot reset that customer',async()=>{
 const f=fixture(),inventory=await prepare(f),proof=await authenticatedIdentity(f,{userId:'33333333-3333-4333-8333-333333333333',provider:'google',subject:'fixture-claim-protection-subject'}),classification=api.createSignupClassifier({inventory,stableKeys:f.keys})(proof.proof),db=new FakeLeaseDatabase(),registryId='tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex'),source=JSON.parse(f.files.get(f.registryName));delete source.customerAccounts.claims[Object.keys(source.customerAccounts.claims)[0]];db.prime(registryId,source);
 const admit=api.createSignupAccountAdmission({inventory,persistence:createCustomerAccountPersistence({rest:db,tenantKey:f.keys.tenantKey}),accountSecret:f.keys.accountSecret});await assert.rejects(()=>admit(classification),/LEGACY_REGISTRY_NOT_PRESERVED/);assert.equal(Object.keys(db.rows.get(registryId).state.customerAccounts.accounts).length,2);
});
