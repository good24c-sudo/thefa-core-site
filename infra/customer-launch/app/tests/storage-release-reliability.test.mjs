import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,blank} from './launch-fixture.mjs';
import {createFreshLaunchAccounts,launchRegistryId} from '../server/fresh-launch-accounts.mjs';
import {TenantStateStore,TenantArtifactStorage} from '../server/inherited/customer-tenant-storage.mjs';
async function signed(x,email='storage-qa@example.test'){
 await x.authService.auth.api.sendVerificationOTP({body:{email,type:'sign-in'}});
 const r=await x.authService.auth.api.signInEmailOTP({body:{email,otp:x.sent.at(-1).otp},asResponse:true});assert.equal(r.status,200);
 return r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
}
const accounts=x=>createFreshLaunchAccounts({authService:x.authService,rest:x.db,config:x.cfg});
test('admission recovers exact version-zero empty launch registry through guarded lease without email rate-limit side effects',async()=>{
 const x=await setup(),cookie=await signed(x);x.db.prime(launchRegistryId,null,{version:0});
 const p=await accounts(x).resolve(cookie,{admit:true});assert.equal(p.accountProvenance,'LAUNCH_ACCOUNT_CONFIRMED');
 const row=x.db.snapshot(launchRegistryId);assert.ok(row.version>=1);assert.equal(Object.keys(row.state.launchAccounts.accounts).length,1);assert.equal(row.owner,null);
});
test('nonempty version-zero registry is corruption, not a fresh initialization',async()=>{
 const x=await setup(),cookie=await signed(x);x.db.prime(launchRegistryId,blank(),{version:0});const before=x.db.snapshot(launchRegistryId);
 await assert.rejects(()=>accounts(x).resolve(cookie,{admit:true}),/FRESH_LAUNCH_REGISTRY_UNAVAILABLE/);assert.deepEqual(x.db.snapshot(launchRegistryId),before);
});
test('ten overlapping registry admissions succeed with exact counters under independent factory leases',async()=>{
 const x=await setup(),rpc=x.db.rpc.bind(x.db);x.db.rpc=async(name,args)=>{const r=await rpc(name,args);if(name==='core_console_acquire_lease_v3'&&r.granted)await sleep(15);return r;};
 const outcomes=await Promise.all(Array.from({length:10},(_,i)=>accounts(x).limit({email:'parallel'+i+'@example.test',peer:'peer-'+i,operation:'send'})));
 assert.equal(outcomes.filter(r=>r.admitted).length,10);const values=Object.values(x.db.snapshot(launchRegistryId).state.launchAccounts.attempts);assert.equal(values.length,20);assert.ok(values.every(v=>v.count===1));assert.equal(x.db.snapshot(launchRegistryId).owner,null);
});
test('uncertain lease response is never retried as deterministic contention',async()=>{
 const x=await setup();let count=0;x.db.rpc=async()=>{count++;throw Object.assign(new Error('SIMULATED_NETWORK_LOSS_AFTER_COMMIT'),{status:503});};
 await assert.rejects(()=>accounts(x).limit({email:'uncertain@example.test',peer:'peer',operation:'send'}),/SIMULATED_NETWORK_LOSS/);assert.equal(count,1);
});
test('malformed lease success is not a retryable lease-busy signal',async()=>{
 const store=new TenantStateStore({request:async()=>[],rpc:async()=>({granted:true,lease_owner:randomUUID()})},{workspaceId:'tenant_'+'a'.repeat(64)});
 await assert.rejects(()=>store.acquire(),e=>e.code==='TENANT_LEASE_UNVERIFIED'&&e.status===503);
});
for(const failure of ['ARTIFACT_IMMUTABLE','LEASE_LOST','AMBIGUOUS_RPC_ACK'])test('artifact '+failure+' never replaces local committed file or automatically resends',async()=>{
 let calls=0;const rpc=async()=>{calls++;throw Object.assign(new Error(failure),{code:failure});};
 const store={workspaceId:'tenant_'+'b'.repeat(64),owner:randomUUID(),ensureLease:async()=>{}};
 const artifact=new TenantArtifactStorage({rpc},store);await artifact.init();
 try{await fs.writeFile(path.join(artifact.directory,'kept.md'),'original');await assert.rejects(()=>artifact.write('kept.md','replacement'),new RegExp(failure));
  assert.equal(await fs.readFile(path.join(artifact.directory,'kept.md'),'utf8'),'original');assert.deepEqual(await fs.readdir(artifact.directory),['kept.md']);assert.equal(calls,1);
 }finally{await artifact.close();}
});
test('confirmed artifact RPC publishes exact durable bytes locally',async()=>{
 const store={workspaceId:'tenant_'+'c'.repeat(64),owner:randomUUID(),ensureLease:async()=>{}};
 const artifact=new TenantArtifactStorage({rpc:async(_name,args)=>({name:args.p_name,sha256:args.p_sha256})},store);await artifact.init();
 try{await artifact.write('success.md','verified bytes');assert.equal(await fs.readFile(path.join(artifact.directory,'success.md'),'utf8'),'verified bytes');assert.deepEqual(await fs.readdir(artifact.directory),['success.md']);}finally{await artifact.close();}
});
