import test from 'node:test';
import assert from 'node:assert/strict';
let api;try{api=await import('../dedicated-pg.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;api={};}
test('dedicated constrained receipt transport exists',()=>assert.equal(typeof api.createDedicatedReceiptPgTransport,'function','Constrained caller adapter not implemented'));
const params={p_receipt_id:'11111111-1111-4111-8111-111111111111',p_nonce:'a'.repeat(64),p_representative_person_id:'22222222-2222-4222-8222-222222222222',p_scope:'P04:test',p_payload_hash:'sha256:'+'b'.repeat(64),p_source_ref:'native:test-user-message',p_issued_at:'2026-10-29T10:00:00Z',p_expires_at:'2026-10-29T10:02:00Z'};
function poolFixture(role,{wrongRole=false,mutationError=false,commitError=false}={}){
  const queries=[];let releaseError,mutations=0;
  const client={query:async(text,values)=>{queries.push({text,values});if(text==='SELECT current_user::text AS caller')return {rows:[{caller:wrongRole?'postgres':role}]};if(text.startsWith('SELECT public.ceo_core_')){mutations++;if(mutationError)throw Error('sensitive connection credentials');return {rows:[{result:{decision:'TEST_DATABASE_RESULT',verified:true}}]};}if(text==='COMMIT'&&commitError)throw Error('sensitive URI');return {rows:[]};},release:e=>{releaseError=e;}};
  return {pool:{connect:async()=>client},queries,get mutations(){return mutations;},get releaseError(){return releaseError;}};
}
test('register uses fixed issuer role and exact eight parameterized values',async()=>{
 const i=poolFixture('thefa_core_receipt_issuer_v1'),c=poolFixture('thefa_core_receipt_consumer_v1');
 const transport=api.createDedicatedReceiptPgTransport({issuerPool:i.pool,consumerPool:c.pool});
 assert.equal((await transport.register(params)).decision,'TEST_DATABASE_RESULT');
 assert.equal(i.queries[1].text,'SET LOCAL ROLE thefa_core_receipt_issuer_v1');
 const call=i.queries.find(q=>q.text.startsWith('SELECT public.ceo_core_register'));
 assert.deepEqual(call.values,Object.values(params));assert.equal(call.text.includes(params.p_nonce),false);assert.equal(i.mutations,1);assert.equal(c.queries.length,0);assert.equal(i.queries.at(-1).text,'COMMIT');
});
test('consume uses separate fixed consumer caller',async()=>{
 const i=poolFixture('thefa_core_receipt_issuer_v1'),c=poolFixture('thefa_core_receipt_consumer_v1');const t=api.createDedicatedReceiptPgTransport({issuerPool:i.pool,consumerPool:c.pool});await t.consume(params);assert.equal(c.queries[1].text,'SET LOCAL ROLE thefa_core_receipt_consumer_v1');assert.equal(i.queries.length,0);assert.equal(c.mutations,1);
});
test('readScope uses consumer with bounded three argument scope',async()=>{
 const c=poolFixture('thefa_core_receipt_consumer_v1'),i=poolFixture('thefa_core_receipt_issuer_v1');const t=api.createDedicatedReceiptPgTransport({issuerPool:i.pool,consumerPool:c.pool});await t.readScope({receiptId:params.p_receipt_id,scope:'P04:test',idempotencyKey:'customer-test-unique'});const call=c.queries.find(q=>q.text.startsWith('SELECT public.ceo_core_read'));assert.deepEqual(call.values,[params.p_receipt_id,'P04:test','customer-test-unique']);
});
test('caller mismatch rejects before any receipt SQL',async()=>{
 const i=poolFixture('thefa_core_receipt_issuer_v1',{wrongRole:true}),c=poolFixture('thefa_core_receipt_consumer_v1');const t=api.createDedicatedReceiptPgTransport({issuerPool:i.pool,consumerPool:c.pool});await assert.rejects(t.register(params),/DEDICATED_ROLE_NOT_EFFECTIVE/);assert.equal(i.mutations,0);assert.equal(i.queries.at(-1).text,'ROLLBACK');assert.ok(i.releaseError);
});
test('mutation error is sanitized, uncertain and never retried',async()=>{
 const i=poolFixture('thefa_core_receipt_issuer_v1'),c=poolFixture('thefa_core_receipt_consumer_v1',{mutationError:true});const t=api.createDedicatedReceiptPgTransport({issuerPool:i.pool,consumerPool:c.pool});await assert.rejects(t.consume(params),error=>{assert.equal(error.message,'DEDICATED_RECEIPT_OUTCOME_UNKNOWN');assert.equal(error.outcomeUnknown,true);return true;});assert.equal(c.mutations,1);assert.ok(c.releaseError);
});
test('unknown commit does not rerun receipt function',async()=>{
 const i=poolFixture('thefa_core_receipt_issuer_v1',{commitError:true}),c=poolFixture('thefa_core_receipt_consumer_v1');const t=api.createDedicatedReceiptPgTransport({issuerPool:i.pool,consumerPool:c.pool});await assert.rejects(t.register(params),/DEDICATED_RECEIPT_OUTCOME_UNKNOWN/);assert.equal(i.mutations,1);assert.ok(i.releaseError);
});
test('unexpected caller parameters are rejected without connection',async()=>{
 let connects=0;const pool={connect:async()=>{connects++;throw Error();}};const t=api.createDedicatedReceiptPgTransport({issuerPool:pool,consumerPool:pool});await assert.rejects(t.register({...params,sql:'DROP TABLE x'}),/EXACT_RECEIPT_RPC_PARAMETERS_REQUIRED/);assert.equal(connects,0);
});
