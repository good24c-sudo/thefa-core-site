import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
let api;try{api=await import('../native-journal.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;api={};}
test('exact native user journal verifier exists',()=>assert.equal(typeof api.createNativeJournalApprovalVerifier,'function','Native journal verifier not implemented'));
async function fixture({dbType='userMessage',jsonType='userMessage',duplicate=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'r39-native-journal-'));const path=join(dir,'native.sqlite');const db=new DatabaseSync(path);
 db.exec('CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,item_type TEXT,item_json TEXT,created_at_ms INTEGER)');
 const ids={threadId:'11111111-1111-4111-8111-111111111111',turnId:'22222222-2222-4222-8222-222222222222',userMessageId:'33333333-3333-4333-8333-333333333333'};
 const raw=JSON.stringify({type:jsonType,id:ids.userMessageId,clientId:'test-client',content:[{type:'text',text:'TEST ONLY human source approval'}]});
 const values=[ids.threadId,ids.turnId,ids.userMessageId,dbType,raw,1793267254000];db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?)').run(...values);if(duplicate)db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?)').run(...values);db.close();
 return {config:{dbPath:path,...ids,expectedItemSha256:createHash('sha256').update(raw).digest('hex')},async cleanup(){for(const suffix of ['','-wal','-shm']){try{await unlink(path+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}}await rmdir(dir);}};
}
test('reads only exact native user source and returns approval commitment',async()=>{const f=await fixture();try{const v=api.createNativeJournalApprovalVerifier(f.config);const result=await v();assert.equal(result.approvalHash,'sha256:'+f.config.expectedItemSha256);assert.equal(result.approvalRef,'CODEX_NATIVE_USER_MESSAGE:'+f.config.threadId+':'+f.config.turnId+':'+f.config.userMessageId);assert.equal(result.sourceKind,'CODEX_NATIVE_USER_MESSAGE');assert.equal(result.recordsMatched,1);assert.equal(JSON.stringify(result).includes('TEST ONLY'),false);}finally{await f.cleanup();}});
for(const [name,options,code] of [['assistant DBrow',{dbType:'agentMessage'},'EXACT_NATIVE_USER_SOURCE_REQUIRED'],['assistant JSONrow',{jsonType:'agentMessage'},'EXACT_NATIVE_USER_SOURCE_REQUIRED'],['ambiguous duplicate native row',{duplicate:true},'EXACT_SINGLE_NATIVE_USER_ROW_REQUIRED']])test(name+' is rejected',async()=>{const f=await fixture(options);try{await assert.rejects(api.createNativeJournalApprovalVerifier(f.config)(),new RegExp(code));}finally{await f.cleanup();}});
test('changed raw native approval hash rejects',async()=>{const f=await fixture();try{f.config.expectedItemSha256='a'.repeat(64);await assert.rejects(api.createNativeJournalApprovalVerifier(f.config)(),/NATIVE_USER_SOURCE_HASH_MISMATCH/);}finally{await f.cleanup();}});
test('wrong turn cannot borrow user source',async()=>{const f=await fixture();try{f.config.turnId='44444444-4444-4444-8444-444444444444';await assert.rejects(api.createNativeJournalApprovalVerifier(f.config)(),/EXACT_SINGLE_NATIVE_USER_ROW_REQUIRED/);}finally{await f.cleanup();}});
