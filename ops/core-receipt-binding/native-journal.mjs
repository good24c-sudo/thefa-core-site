/** Exact native approval source verification; opens the native journal READ ONLY. */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=code=>{throw new Error(code);};
export function createNativeJournalApprovalVerifier({dbPath,threadId,turnId,userMessageId,expectedItemSha256}={}){
 if(!isAbsolute(dbPath??'')||![threadId,turnId,userMessageId].every(v=>ID.test(v??''))||!/^[a-f0-9]{64}$/.test(expectedItemSha256??''))fail('EXACT_NATIVE_JOURNAL_CONFIG_REQUIRED');
 const approvalRef='CODEX_NATIVE_USER_MESSAGE:'+threadId+':'+turnId+':'+userMessageId;
 return async function verifyExactNativeApproval(){
  let db;
  try{
   db=new DatabaseSync(dbPath,{readOnly:true});db.exec('PRAGMA query_only=ON');
   const rows=db.prepare('SELECT item_type,item_json,created_at_ms FROM thread_items WHERE thread_id=? AND turn_id=? AND item_id=? LIMIT 2').all(threadId,turnId,userMessageId);
   if(rows.length!==1)fail('EXACT_SINGLE_NATIVE_USER_ROW_REQUIRED');
   const row=rows[0];
   if(row.item_type!=='userMessage'||typeof row.item_json!=='string')fail('EXACT_NATIVE_USER_SOURCE_REQUIRED');
   let item;try{item=JSON.parse(row.item_json);}catch{fail('NATIVE_USER_SOURCE_JSON_INVALID');}
   if(item?.type!=='userMessage'||item?.id!==userMessageId||!Array.isArray(item?.content)||!item.content.some(c=>c?.type==='text'&&typeof c.text==='string'&&c.text.trim().length>0))fail('EXACT_NATIVE_USER_SOURCE_REQUIRED');
   const observed=createHash('sha256').update(row.item_json,'utf8').digest('hex');
   if(observed!==expectedItemSha256)fail('NATIVE_USER_SOURCE_HASH_MISMATCH');
   return Object.freeze({sourceKind:'CODEX_NATIVE_USER_MESSAGE',approvalRef,approvalHash:'sha256:'+observed,threadId,turnId,userMessageId,recordsMatched:1,createdAtMs:row.created_at_ms});
  }catch(error){
   if(/^EXACT_|^NATIVE_USER_/.test(error.message))throw error;
   fail('NATIVE_JOURNAL_READ_FAILED');
  }finally{db?.close();}
 };
}
