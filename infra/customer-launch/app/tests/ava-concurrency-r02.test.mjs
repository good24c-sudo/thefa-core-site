import test from 'node:test';
import assert from 'node:assert/strict';
import { mutateCustomerChat,workspaceOverview } from '../server/inherited/customer-chat-domain.mjs';
import { executeCustomerChatApi } from '../server/inherited/customer-chat-api.mjs';
const blank=()=>({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}});
const update=(s,p,key)=>mutateCustomerChat(s,'ava.update',p,key);

test('stale second tab cannot overwrite a newer My AVA profile',()=>{
 const s=blank();update(s,{role:'개발',expectedProfileRevision:0},'r02-tab-a-0001');
 const before=structuredClone(s);
 assert.throws(()=>update(s,{role:'사업',expectedProfileRevision:0},'r02-tab-b-0001'),e=>e.status===409&&e.message==='AVA_PROFILE_REVISION_CONFLICT');
 assert.deepEqual(s,before);
});
test('matching revision accepts one update while retaining identity',()=>{
 const s=blank();const first=update(s,{role:'개발',expectedProfileRevision:0},'r02-match-0001');
 const second=update(s,{role:'검토',expectedProfileRevision:1},'r02-match-0002');
 assert.equal(second.ava.profileRevision,2);assert.equal(second.ava.identityId,first.ava.identityId);
});
test('invalid client revision values fail without mutation',()=>{
 for(const value of [-1,0.5,'1',true,null,Number.MAX_SAFE_INTEGER+1]){
  const s=blank(),before=structuredClone(s);
  assert.throws(()=>update(s,{role:'개발',expectedProfileRevision:value},'r02-bad-rev-0001'),e=>e.status===400&&e.message==='AVA_PROFILE_REVISION_INVALID');
  assert.deepEqual(s,before);
 }
});
test('same successful request is reusable even though revision has advanced',()=>{
 const s=blank(),payload={role:'개발',expectedProfileRevision:0};
 const a=update(s,payload,'r02-retry-0001');
 const b=update(s,payload,'r02-retry-0001');
 assert.equal(b.reused,true);assert.equal(b.ava.identityId,a.ava.identityId);assert.equal(b.ava.profileRevision,1);
});
test('legacy callers remain compatible but never acquire execution rights',()=>{
 const s=blank();update(s,{role:'기획'},'r02-old-0001');
 const b=update(s,{role:'개발'},'r02-old-0002');
 assert.equal(b.executable,false);assert.equal(b.ava.memorySharing,'PRIVATE_BY_DEFAULT_NO_SHARE');
 assert.equal(workspaceOverview(s).capabilities.avaExecutionReady,false);
});
test('API returns a specific 409 conflict instead of a generic service failure',async()=>{
 let saved=blank();
 const persistenceFactory=()=>({store:{state:structuredClone(saved),async init(){this.state=structuredClone(saved)},async mutate(fn){const next=structuredClone(saved);const result=fn(next);saved=next;this.state=structuredClone(saved);return result},async close(){}}});
 const env={CORE_CONSOLE_STORAGE_MODE:'tenant-v3',CORE_CUSTOMER_TENANT_HMAC_KEY:'r02-test-only-key-not-real-credential-123456789012'};
 const ctx={email:'r02-user@example.test',env,persistenceFactory};
 const request=(id,role)=>executeCustomerChatApi('/api/customer/action','POST',{action:'ava.update',payload:{role,expectedProfileRevision:0},requestId:id},ctx);
 assert.equal((await request('r02-api-0001','개발')).status,200);
 const result=await request('r02-api-0002','사업');
 assert.equal(result.status,409);assert.equal(JSON.parse(result.body).code,'AVA_PROFILE_REVISION_CONFLICT');
 assert.equal(workspaceOverview(saved).settings.ava.role,'개발');
});
