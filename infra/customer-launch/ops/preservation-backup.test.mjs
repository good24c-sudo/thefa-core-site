import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {validateBackup,isolatedRestoreSql,createEncryptedBackup,BACKUP_SQL} from './preservation-backup.mjs';
import {PRESERVED_TABLES} from './preservation-readback.mjs';
import {TARGET} from './credential-io.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
  const row='{"id": "고객 \' ; DROP TABLE test; --", "version": 9007199254740993}';
  const tables=PRESERVED_TABLES.map(table_name=>({table_name,columns:[{name:'id',type:'text',not_null:true},{name:'version',type:'bigint',not_null:true}],rows:[row]}));
  const baseline={project_ref:TARGET.project,database:'postgres',primary:true,security_sha256:'1'.repeat(64),
    tables:tables.map(t=>({table_name:t.table_name,row_count:t.rows.length,rowset_sha256:sha(t.rows.join('\n'))}))};
  return {contract:'P04_CUSTOMER_DATA_BACKUP_V1',project_ref:TARGET.project,captured_at:new Date().toISOString(),tables,baseline};
}
test('restore preserves bigint lexical precision and quotes customer text',()=>{
  const sql=isolatedRestoreSql(fixture());assert.match(sql,/9007199254740993/);assert.match(sql,/고객 '' ; DROP TABLE test; --/);
  assert.match(sql,/standard_conforming_strings=on/);assert.doesNotMatch(sql,/IF NOT EXISTS|TRUNCATE|ON CONFLICT|DELETE FROM/);
});
test('missing rows, unsupported types and altered counts cannot become a backup',()=>{
  for(const mutate of [b=>b.tables[0].rows.pop(),b=>b.tables[0].columns[0].type='text); SELECT secret;',b=>b.baseline.tables[0].row_count=0]){
    const b=fixture();mutate(b);assert.throws(()=>validateBackup(b),/BACKUP/);
  }
});
test('backup uses exclusive DPAPI write and actual readback before returning private data',async()=>{
  const backup=fixture(),events=[];let privateValue;
  const io={query:async sql=>sql===BACKUP_SQL?[{backup}]:[{preservation:backup.baseline}],
    vault:async(name,op,value)=>{events.push(op);if(op==='WriteNew'){privateValue=value;return '{"stored":true}';}return privateValue;}};
  const r=await createEncryptedBackup({io,backupId:randomUUID()});assert.deepEqual(events,['WriteNew','Read']);assert.equal(r.backup,backup);
});
test('damaged encrypted readback and a changing source cannot be called restored',async()=>{
  const backup=fixture();let privateValue;
  const io={query:async sql=>sql===BACKUP_SQL?[{backup}]:[{preservation:{...backup.baseline,security_sha256:'2'.repeat(64)}}],
    vault:async(name,op,value)=>{if(op==='WriteNew'){privateValue=value;return '';}return privateValue+' ';}};
  await assert.rejects(createEncryptedBackup({io,backupId:randomUUID()}),/ENCRYPTED_BACKUP_READBACK_MISMATCH/);
  io.vault=async(name,op,value)=>{if(op==='WriteNew'){privateValue=value;return '';}return privateValue;};
  await assert.rejects(createEncryptedBackup({io,backupId:randomUUID()}),/SOURCE_CHANGED/);
});
