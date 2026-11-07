/** Least privilege direct-PG transports. Pools/configuration are trusted server inputs.
 * Every mutation is sent once. A network/commit ambiguity destroys its connection
 * and requires original receipt readback; it never triggers a mutation retry.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^sha256:[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{64}$/;
const string=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
function fail(code,unknown=false){const error=new Error(code);error.outcomeUnknown=unknown;throw error;}
const fields=['p_receipt_id','p_nonce','p_representative_person_id','p_scope','p_payload_hash','p_source_ref','p_issued_at','p_expires_at'];
const args8='$1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::timestamptz,$8::timestamptz';

function receiptParams(p){
 if(!p||Object.keys(p).sort().join('|')!==[...fields].sort().join('|')||!UUID.test(p.p_receipt_id??'')||!NONCE.test(p.p_nonce??'')||!string(p.p_representative_person_id,128)||!string(p.p_scope,500)||!HASH.test(p.p_payload_hash??'')||!string(p.p_source_ref,600)||!Number.isFinite(Date.parse(p.p_issued_at))||!Number.isFinite(Date.parse(p.p_expires_at)))fail('EXACT_RECEIPT_RPC_PARAMETERS_REQUIRED');
 return fields.map(k=>p[k]);
}

export async function withDedicatedRole(pool,role,query,values){
 if(!pool||typeof pool.connect!=='function')fail('SERVER_OWNED_DEDICATED_POOL_REQUIRED');
 if(!['thefa_core_receipt_issuer_v1','thefa_core_receipt_consumer_v1'].includes(role))fail('FIXED_DEDICATED_ROLE_REQUIRED');
 let client,discard=false,started=false;
 try{
  client=await pool.connect();
  await client.query('BEGIN');started=true;
  await client.query('SET LOCAL ROLE '+role);
  const caller=await client.query('SELECT current_user::text AS caller');
  if(caller?.rows?.length!==1||caller.rows[0].caller!==role)fail('DEDICATED_ROLE_NOT_EFFECTIVE');
  const result=await client.query(query,values);
  if(result?.rows?.length!==1||!Object.hasOwn(result.rows[0],'result'))fail('EXACT_SCOPED_DB_RESULT_REQUIRED');
  await client.query('COMMIT');started=false;
  return result.rows[0].result;
 }catch(error){
  discard=true;
  if(client&&started){try{await client.query('ROLLBACK');}catch{/* preserve uncertainty; do not retry */}}
  if(error.message==='DEDICATED_ROLE_NOT_EFFECTIVE')throw error;
  fail('DEDICATED_RECEIPT_OUTCOME_UNKNOWN',true);
 }finally{if(client)client.release(discard?new Error('DISCARD_UNCERTAIN_CONNECTION'):undefined);}
}

export function createDedicatedReceiptPgTransport({issuerPool,consumerPool}={}){
 if(typeof issuerPool?.connect!=='function'||typeof consumerPool?.connect!=='function')fail('SEPARATE_DEDICATED_POOLS_REQUIRED');
 return Object.freeze({
  register:async p=>withDedicatedRole(issuerPool,'thefa_core_receipt_issuer_v1','SELECT public.ceo_core_register_representative_write_receipt_v1('+args8+') AS result',receiptParams(p)),
  consume:async p=>withDedicatedRole(consumerPool,'thefa_core_receipt_consumer_v1','SELECT public.ceo_core_consume_representative_write_receipt_v1('+args8+') AS result',receiptParams(p)),
  readScope:async({receiptId,scope,idempotencyKey}={})=>{
   if(!UUID.test(receiptId??'')||!string(scope,500)||!string(idempotencyKey,600))fail('EXACT_SCOPED_READ_PARAMETERS_REQUIRED');
   return withDedicatedRole(consumerPool,'thefa_core_receipt_consumer_v1','SELECT public.ceo_core_read_representative_receipt_scope_v2($1::uuid,$2::text,$3::text) AS result',[receiptId,scope,idempotencyKey]);
  },
 });
}
