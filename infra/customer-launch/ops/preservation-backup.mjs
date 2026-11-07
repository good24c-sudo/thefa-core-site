import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {TARGET,create4060IO,runPrivate} from './credential-io.mjs';
import {PRESERVED_TABLES,PRESERVATION_SQL,readCustomerPreservation,validatePreservationSnapshot} from './preservation-readback.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const allowedTypes=new Set(['text','boolean','timestamp with time zone','bigint','uuid','jsonb']);
export const BACKUP_SQL=`WITH preservation_snapshot AS (${PRESERVATION_SQL.replace(/;\s*$/,'')})
SELECT jsonb_build_object('contract','P04_CUSTOMER_DATA_BACKUP_V1','project_ref','${TARGET.project}',
 'captured_at',transaction_timestamp(),'baseline',(SELECT preservation FROM preservation_snapshot),
 'tables',jsonb_build_array(${PRESERVED_TABLES.map(name=>{
  const [schema,table]=name.split('.');
  return `jsonb_build_object('table_name','${name}',
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'not_null',attnotnull) ORDER BY attnum)
     FROM pg_attribute WHERE attrelid='${name}'::regclass AND attnum>0 AND NOT attisdropped),
   'rows',(SELECT coalesce(jsonb_agg(to_jsonb(t)::text ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb) FROM "${schema}"."${table}" t))`;
}).join(',')})) AS backup;`;

export function validateBackup(backup){
  if(backup?.contract!=='P04_CUSTOMER_DATA_BACKUP_V1'||backup.project_ref!==TARGET.project||
     !Number.isFinite(Date.parse(backup.captured_at))||!Array.isArray(backup.tables)||
     JSON.stringify(backup.tables.map(t=>t.table_name))!==JSON.stringify(PRESERVED_TABLES))fail('COMPLETE_CUSTOMER_BACKUP_REQUIRED');
  validatePreservationSnapshot(backup.baseline);
  for(let i=0;i<backup.tables.length;i++){
    const table=backup.tables[i],expected=backup.baseline.tables[i];
    if(!Array.isArray(table.rows)||table.rows.some(row=>typeof row!=='string')||table.rows.length!==expected.row_count||
       hash(table.rows.join('\n'))!==expected.rowset_sha256)fail('CUSTOMER_BACKUP_CONTENT_MISMATCH');
    if(!Array.isArray(table.columns)||!table.columns.length||new Set(table.columns.map(c=>c.name)).size!==table.columns.length||
       table.columns.some(c=>!/^[_A-Za-z][_A-Za-z0-9]*$/.test(c.name??'')||!allowedTypes.has(c.type)||typeof c.not_null!=='boolean'))
      fail('CUSTOMER_BACKUP_COLUMN_CONTRACT_UNSUPPORTED');
  }
  return backup;
}

// Only used in a new network-none container. No restore method accepts a remote
// database URL, and no backup row is ever printed or written in plaintext.
export function isolatedRestoreSql(backup){
  validateBackup(backup);
  let sql='BEGIN; SET LOCAL standard_conforming_strings=on; SET LOCAL timezone=\'UTC\'; CREATE SCHEMA core_customer_auth;\n';
  for(const t of backup.tables){
    const name=t.table_name.split('.').map(p=>'"'+p+'"').join('.');
    sql+='CREATE TABLE '+name+' ('+t.columns.map(c=>'"'+c.name+'" '+c.type+(c.not_null?' NOT NULL':'')).join(',')+');\n';
    // Keep each server-produced JSON row as text to preserve bigint precision.
    const json='['+t.rows.join(',')+']';
    sql+='INSERT INTO '+name+' SELECT * FROM jsonb_populate_recordset(NULL::'+name+',\''+json.replaceAll("'","''")+'\'::jsonb);\n';
  }
  return sql+'COMMIT;';
}

export async function createEncryptedBackup({io,backupId}){
  if(!UUID.test(backupId??''))fail('EXACT_BACKUP_ID_REQUIRED');
  const rows=await io.query(BACKUP_SQL);
  if(!Array.isArray(rows)||rows.length!==1)fail('COMPLETE_CUSTOMER_BACKUP_REQUIRED');
  const backup=validateBackup(rows[0].backup),raw=JSON.stringify(backup),name=backupId+'.rollback.dpapi';
  // Existing CreateNew+DPAPI+ACL checks prevent overwriting an earlier backup.
  await io.vault(name,'WriteNew',raw);
  const readback=await io.vault(name,'Read');
  if(hash(readback)!==hash(raw))fail('ENCRYPTED_BACKUP_READBACK_MISMATCH');
  validateBackup(JSON.parse(readback));
  const current=await readCustomerPreservation(io);
  if(JSON.stringify(current.tables)!==JSON.stringify(backup.baseline.tables)||current.security_sha256!==backup.baseline.security_sha256)
    fail('SOURCE_CHANGED_AFTER_BACKUP_RECONCILE_REQUIRED');
  return {name,backup}; // Process-private; callers output only the safe receipt.
}

export async function restoreBackupIsolated({backup,image,run=runPrivate}){
  validateBackup(backup);
  if(!/^[a-f0-9]{12,64}$/.test(image??''))fail('EXISTING_POSTGRES17_IMAGE_REQUIRED');
  const container='thefa-customer-backup-'+randomUUID();let created=false,stopped=false;
  const docker=(args,input='')=>run('docker',args,input,60000);
  const sql=text=>docker(['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],text);
  try{
    await docker(['image','inspect',image]);
    await docker(['run','-d','--rm','--name',container,'--network','none','--memory','256m','--cpus','1',
      '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=192m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;
    let ready=false;
    for(let i=0;i<40;i++){try{await docker(['exec',container,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
    if(!ready)fail('ISOLATED_POSTGRES_NOT_READY');
    const info=JSON.parse(await docker(['inspect',container]))[0];
    if(info.HostConfig.NetworkMode!=='none'||Object.keys(info.NetworkSettings.Ports??{}).length||info.HostConfig.Binds?.length||
       Object.keys(info.HostConfig.Tmpfs??{}).join()!=='/var/lib/postgresql/data')fail('ISOLATED_RESTORE_BOUNDARY_REQUIRED');
    if(!/^17\./.test((await sql('SHOW server_version;')).trim()))fail('POSTGRES17_REQUIRED');
    await sql(isolatedRestoreSql(backup));
    // Security catalogs are intentionally different in this private restore;
    // restoration proves exact typed rows, not a Production ACL deployment.
    const rowSql=PRESERVED_TABLES.map(name=>{const table=name.split('.').map(p=>'"'+p+'"').join('.');
      return `SELECT '${name}' AS table_name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_json,E'\\n' ORDER BY row_json COLLATE "C"),''),'UTF8')),'hex') AS rowset_sha256 FROM (SELECT to_jsonb(t)::text row_json FROM ${table} t) rows`;}).join(' UNION ALL ');
    const restored=JSON.parse((await sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY table_name) FROM ('+rowSql+') r;')).trim());
    if(JSON.stringify(restored.map(r=>[r.table_name,r.row_count,r.rowset_sha256]))!==JSON.stringify(backup.baseline.tables.map(r=>[r.table_name,r.row_count,r.rowset_sha256])))fail('ACTUAL_RESTORE_CONTENT_MISMATCH');
    let replayRefused=false;try{await sql(isolatedRestoreSql(backup));}catch{replayRefused=true;}
    if(!replayRefused)fail('RESTORE_REPLAY_GUARD_REQUIRED');
    await docker(['stop','--time','1',container]);stopped=true;
    return {postgres17:true,typed_rowsets_verified:8,replay_refused:true,network:'none',ports:0,plaintext_disk_files:0,
      container_removed:true,acl_restore_tested:false,production_mutations:0};
  }finally{if(created&&!stopped)await docker(['stop','--time','1',container]);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const [backupId,image,receiptPath]=process.argv.slice(2);
    if(!receiptPath||!path.isAbsolute(receiptPath))fail('ABSOLUTE_RECEIPT_PATH_REQUIRED');
    const io=create4060IO(),{name,backup}=await createEncryptedBackup({io,backupId});
    const restored=await restoreBackupIsolated({backup,image});
    const after=await readCustomerPreservation(io);
    if(JSON.stringify(after.tables)!==JSON.stringify(backup.baseline.tables)||after.security_sha256!==backup.baseline.security_sha256)
      fail('SOURCE_CHANGED_DURING_RESTORE_RECONCILE_REQUIRED');
    const receipt={kind:'ACTUAL_SAME_HOST_ENCRYPTED_BACKUP_AND_TYPED_RESTORE',at:new Date().toISOString(),host:TARGET.host,
      project_ref:TARGET.project,backup_path:TARGET.vault+'/'+name,baseline:backup.baseline,restored,
      source_unchanged_before_after:true,authority_granted:false,stage2_executed:false,full_release_rollback_verified:false};
    await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({receipt:receiptPath,typed_rowsets_verified:8,production_mutations:0,authority_granted:false}));
  }catch(e){console.error(/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'BACKUP_OR_RESTORE_FAILED_RECONCILE');process.exitCode=1;}
}
