import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateProductionManifest,verifyProductionArtifacts,createCustomerProductionTransport} from '../customer-production.mjs';
const h=s=>createHash('sha256').update(s).digest('hex');
const binding={operation_kind:'CUSTOMER_PRODUCTION_AUTH',head_sha:'a'.repeat(40),idempotency_key:'CUSTOMER_AUTH_TEST_ONLY',target_environment:'PRODUCTION',project_key:'P04',room_family:'00',room_instance:'00_v25',workstream_key:'THE_FA_CORE_CUSTOMER_LAUNCH_V1',repository:'good24c-sudo/thefa-core-site',branch:'codex/core-customer-launch-v1-20261029'};
const make=()=>({contract:'THE_FA_CUSTOMER_PRODUCTION_AUTH_V1',action:'CUSTOMER_AUTH_PRODUCTION_CUTOVER',environment:'PRODUCTION',supabase_project_ref:'cgrppxfdurpzzfvkmfte',vercel_project_id:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',origin:'https://thefacore.com',operations:['INSTALL_AUTH_SCHEMA'],preserve_data:true,reset_usage_epoch:false,replay_original_job:false,protected_session_id:'111c339990e7926f4e8b226e',expected_head:binding.head_sha,idempotency_key:binding.idempotency_key,artifacts:[{operation:'INSTALL_AUTH_SCHEMA',path:'install.sql',sha256:h('select 1;')}]});
test('exact canonical manifest binds artifact bytes',()=>{const m=make(),r=validateProductionManifest(m,binding);assert.equal(r.payloadHash,'sha256:'+h(r.canonical));m.artifacts[0].sha256='b'.repeat(64);assert.notEqual(validateProductionManifest(m,binding).payloadHash,r.payloadHash);});
for(const [key,value] of [['environment','STAGING'],['supabase_project_ref','other'],['vercel_project_id','other'],['preserve_data',false],['reset_usage_epoch',true],['replay_original_job',true],['protected_session_id','other'],['expected_head','b'.repeat(40)],['operations',['DELETE_CUSTOMER_DATA']],['extra',true]]){
 test('rejects altered '+key,()=>{const m=make();m[key]=value;assert.throws(()=>validateProductionManifest(m,binding));});
}
for(const file of ['../secret','/root/file','C:/secret','a\\b','a//b','NUL.txt','safe/../file','file.','file ','name:stream'])test('rejects unsafe path '+file,()=>{const m=make();m.artifacts[0].path=file;assert.throws(()=>validateProductionManifest(m,binding));});
test('every authorized operation must have pinned artifacts',()=>{const m=make();m.operations.push('PRESERVE_CUSTOMER_MIGRATION');assert.throws(()=>validateProductionManifest(m,binding),/FIXED_ARTIFACT/);});
test('artifact actual byte change is rejected',async()=>{const dir=await mkdtemp(join(tmpdir(),'thefa-production-test-'));try{await writeFile(join(dir,'install.sql'),'select 1;');await verifyProductionArtifacts(dir,make(),binding);await writeFile(join(dir,'install.sql'),'select 2;');await assert.rejects(verifyProductionArtifacts(dir,make(),binding),/ARTIFACT_BYTES_CHANGED/);}finally{await rm(dir,{recursive:true});}});
test('consumer uses fixed role and parameterized RPC exactly once',async()=>{
 const queries=[];let released;
 const client={query:async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('SELECT current_user'))return {rows:[{caller:'thefa_core_receipt_consumer_v1'}]};if(sql.includes('consume_v1'))return {rows:[{result:{verified:false,decision:'CUSTOMER_PRODUCTION_RECEIPT_REJECTED'}}]};return {rows:[]};},release:e=>{released=e;}};
 const pool={connect:async()=>client};const transport=createCustomerProductionTransport({issuerPool:pool,consumerPool:pool});
 await transport.consume({receiptId:'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',nonce:'a'.repeat(64),payloadHash:'sha256:'+'b'.repeat(64),idempotencyKey:binding.idempotency_key});
 assert.equal(queries.filter(q=>q.sql.includes('consume_v1')).length,1);assert.ok(queries.some(q=>q.sql==='SET LOCAL ROLE thefa_core_receipt_consumer_v1'));assert.equal(released,undefined);
});
test('ambiguous commit is not retried',async()=>{
 let calls=0,discard=false;const client={query:async sql=>{if(sql==='COMMIT')throw Error('connection lost');if(sql.startsWith('SELECT current_user'))return {rows:[{caller:'thefa_core_receipt_consumer_v1'}]};if(sql.includes('consume_v1')){calls++;return {rows:[{result:{verified:true}}]};}return {rows:[]};},release:e=>{discard=!!e;}};
 const pool={connect:async()=>client},transport=createCustomerProductionTransport({issuerPool:pool,consumerPool:pool});
 await assert.rejects(transport.consume({receiptId:'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',nonce:'a'.repeat(64),payloadHash:'sha256:'+'b'.repeat(64),idempotencyKey:binding.idempotency_key}),e=>e.outcomeUnknown===true);assert.equal(calls,1);assert.equal(discard,true);
});
