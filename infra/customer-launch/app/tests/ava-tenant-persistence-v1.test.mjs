import test from 'node:test';
import assert from 'node:assert/strict';
import { mutateCustomerChat, workspaceOverview } from '../server/inherited/customer-chat-domain.mjs';
const blank=()=>({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}});
const mutate=(state,payload,id)=>mutateCustomerChat(state,'ava.update',payload,id);
test('one tenant receives one persistent My AVA identity across role changes',()=>{
  const s=blank();
  const a=mutate(s,{role:'기획',memoryScope:'선택한 프로젝트만'},'ava-request-000001').ava;
  const b=mutate(s,{role:'개발',memoryScope:'현재 대화만'},'ava-request-000002').ava;
  assert.match(a.identityId,/^myava_[0-9a-f-]{36}$/);
  assert.equal(a.identityId,b.identityId);
  assert.equal(a.profileRevision,1);
  assert.equal(b.profileRevision,2);
  assert.equal(b.role,'개발');
  assert.equal(b.identityContract,'ONE_MY_AVA_ROLE_AS_CAPABILITY');
  assert.equal(workspaceOverview(s).settings.ava.identityId,a.identityId);
});
test('separate tenant states never have matching digital identities',()=>{
  const left=blank(),right=blank();
  const a=mutate(left,{role:'검토'},'ava-request-000003').ava;
  const b=mutate(right,{role:'검토'},'ava-request-000003').ava;
  assert.notEqual(a.identityId,b.identityId);
  assert.equal(workspaceOverview(left).settings.ava.identityId,a.identityId);
  assert.equal(workspaceOverview(right).settings.ava.identityId,b.identityId);
});
test('invalid AVA enum values fail without any state mutation',()=>{
  for(const [field,value,code] of [
    ['role','admin','AVA_ROLE_INVALID'],
    ['memoryScope','전 고객 기억 공유','AVA_MEMORY_SCOPE_INVALID'],
    ['permissions','쓰기 무제한','AVA_PERMISSIONS_INVALID'],
    ['budget','무제한 과금','AVA_BUDGET_INVALID'],
  ]){
    const state=blank();
    const before=structuredClone(state);
    assert.throws(()=>mutate(state,{[field]:value},'ava-request-000004'),e=>e.code===code);
    assert.deepEqual(state,before);
  }
});
test('preference for external execution does not grant sharing, PC, or model',()=>{
  const state=blank();
  const result=mutate(state,{permissions:'승인 후 외부 실행',budget:'확인된 한도 안에서만'},'ava-request-000005');
  assert.equal(result.ava.executionReady,false);
  assert.equal(result.ava.pcAccess,false);
  assert.equal(result.ava.memorySharing,'PRIVATE_BY_DEFAULT_NO_SHARE');
  assert.equal(result.executable,false);
  assert.equal(result.shared,false);
  assert.equal(workspaceOverview(state).capabilities.avaExecutionReady,false);
});
test('duplicate request is idempotent and cannot multiply AVA identities',()=>{
  const state=blank(),payload={role:'개발'};
  const first=mutate(state,payload,'ava-request-000006');
  const duplicate=mutate(state,payload,'ava-request-000006');
  assert.equal(duplicate.reused,true);
  assert.equal(duplicate.ava.identityId,first.ava.identityId);
  assert.equal(duplicate.ava.profileRevision,1);
  assert.equal(workspaceOverview(state).settings.ava.profileRevision,1);
});
test('caller cannot inject replacement identity or forged consent',()=>{
  const state=blank();
  const first=mutate(state,{role:'기획'},'ava-request-000007');
  const second=mutate(state,{role:'사업',identityId:'myava_forged',memorySharing:'PUBLIC',executionReady:true},'ava-request-000008');
  assert.equal(second.ava.identityId,first.ava.identityId);
  assert.equal(second.ava.memorySharing,'PRIVATE_BY_DEFAULT_NO_SHARE');
  assert.equal(second.ava.executionReady,false);
});
test('invalid existing AVA identity fails closed without silent reset',()=>{
  const state=blank();
  mutate(state,{role:'기획'},'ava-request-000009');
  state.customerChat.settings.ava.identityId='evil';
  const before=structuredClone(state);
  assert.throws(()=>mutate(state,{role:'개발'},'ava-request-000010'),/AVA_IDENTITY_CORRUPT/);
  assert.deepEqual(state,before);
});

import { executeCustomerChatApi } from '../server/inherited/customer-chat-api.mjs';
test('authenticated tenant API persists the one AVA identity per account',async()=>{
  const snapshots=new Map();
  const persistenceFactory=email=>{
    if(!snapshots.has(email))snapshots.set(email,blank());
    return {store:{
      state:structuredClone(snapshots.get(email)),
      async init(){this.state=structuredClone(snapshots.get(email));},
      async mutate(fn){const latest=structuredClone(snapshots.get(email));const result=fn(latest);snapshots.set(email,structuredClone(latest));this.state=structuredClone(latest);return result;},
      async close(){}
    }};
  };
  const env={CORE_CONSOLE_STORAGE_MODE:'tenant-v3',CORE_CUSTOMER_TENANT_HMAC_KEY:'ava-test-independent-hmac-key-for-tenants-0123456789'};
  const ctx=email=>({email,env,persistenceFactory});
  const action=async(email,id,role)=>{
    const result=await executeCustomerChatApi('/api/customer/action','POST',{action:'ava.update',payload:{role},requestId:id},ctx(email));
    assert.equal(result.status,200);
    return JSON.parse(result.body).ava;
  };
  const alice=await action('alice@example.test','ava-api-request-001','기획');
  const aliceUpdate=await action('alice@example.test','ava-api-request-002','개발');
  const bob=await action('bob@example.test','ava-api-request-003','검토');
  assert.equal(alice.identityId,aliceUpdate.identityId);
  assert.notEqual(alice.identityId,bob.identityId);
  const read=await executeCustomerChatApi('/api/customer/workspace','GET',undefined,ctx('alice@example.test'));
  assert.equal(read.status,200);
  assert.equal(JSON.parse(read.body).settings.ava.identityId,alice.identityId);
  assert.equal(JSON.parse(read.body).capabilities.avaExecutionReady,false);
});
