import {createHash} from 'node:crypto';
import {TARGET} from './credential-io.mjs';

export const PRESERVED_TABLES=Object.freeze([
  'core_customer_auth.account','core_customer_auth.session','core_customer_auth.user','core_customer_auth.verification',
  'public.core_console_artifacts_v2','public.core_console_artifacts_v3','public.core_console_state_v2','public.core_console_state_v3'
]);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashSql=sql=>`encode(sha256(convert_to((${sql})::text,'UTF8')),'hex')`;
const relationFilter="(n.nspname='core_customer_auth' OR (n.nspname='public' AND c.relname IN ('core_console_artifacts_v2','core_console_artifacts_v3','core_console_state_v2','core_console_state_v3')))";
// A single MVCC snapshot; no customer rows or credential verifier leaves PostgreSQL.
// Hash all row contents, including allowance fields, instead of accepting counts alone.
export const PRESERVATION_SQL=`WITH rowsets AS (
${PRESERVED_TABLES.map(name=>{
  const [schema,table]=name.split('.');
  return `SELECT '${name}' AS table_name, count(*) AS row_count,
    encode(sha256(convert_to(coalesce(string_agg(row_json,E'\\n' ORDER BY row_json COLLATE "C"),''),'UTF8')),'hex') AS rowset_sha256
    FROM (SELECT to_jsonb(t)::text AS row_json FROM "${schema}"."${table}" t) rows`;
}).join('\nUNION ALL\n')}
), relations AS (
 SELECT c.oid,c.relname,n.nspname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND ${relationFilter}
), security AS (
 SELECT jsonb_build_object(
 'relations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY nspname,relname) FROM relations r),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a WHERE attrelid IN (SELECT oid FROM relations) AND attnum>0 AND NOT attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY polrelid,polname) FROM pg_policy p WHERE polrelid IN (SELECT oid FROM relations)),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY conrelid,conname) FROM pg_constraint c WHERE conrelid IN (SELECT oid FROM relations)),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tgrelid,tgname) FROM pg_trigger t WHERE tgrelid IN (SELECT oid FROM relations)),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY nspname) FROM pg_namespace n WHERE nspname IN ('core_customer_auth','public')),
 'default_acl',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
 'runtime_role',(SELECT to_jsonb(r)-'rolpassword' FROM pg_authid r WHERE rolname='core_customer_auth_runtime'),
 'role_settings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY setdatabase,setrole) FROM pg_db_role_setting s),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='core_customer_auth' OR (n.nspname='public' AND p.proname LIKE 'core_console_%'))
 ) AS state
)
SELECT jsonb_build_object('project_ref','${TARGET.project}','database',current_database(),'primary',NOT pg_is_in_recovery(),
 'tables',(SELECT jsonb_agg(to_jsonb(r) ORDER BY table_name) FROM rowsets r),
 'security_sha256',${hashSql('SELECT state FROM security')}) AS preservation;`;

export function validatePreservationSnapshot(snapshot){
  if(snapshot?.project_ref!==TARGET.project||snapshot.database!=='postgres'||snapshot.primary!==true||
     !/^[a-f0-9]{64}$/.test(snapshot.security_sha256??'')||!Array.isArray(snapshot.tables)||
     JSON.stringify(snapshot.tables.map(r=>r.table_name))!==JSON.stringify(PRESERVED_TABLES)||
     snapshot.tables.some(r=>!Number.isSafeInteger(r.row_count)||r.row_count<0||!/^[a-f0-9]{64}$/.test(r.rowset_sha256??'')))
    fail('COMPLETE_PRIMARY_PRESERVATION_READBACK_REQUIRED');
  return snapshot;
}

export async function readCustomerPreservation(io){
  const rows=await io.query(PRESERVATION_SQL);
  if(!Array.isArray(rows)||rows.length!==1)fail('COMPLETE_PRIMARY_PRESERVATION_READBACK_REQUIRED');
  return validatePreservationSnapshot(rows[0].preservation);
}

/** Data/ACL component of assertPreservation, not an admission or backup verifier.
 * artifactBytes must be the exact release plan bound by the real live claim.
 * The trusted provider must ALSO verify backups/restore, rollback release,
 * ownership, exclusive release and coherent environment before any mutation.
 */
export async function assertCustomerPreserved({io,claim,artifactBytes}){
  const artifact=claim?.manifest?.artifacts?.[0];
  if(claim?.decision!=='WORKER_CLAIMED'||claim.manifest.artifacts.length!==1||
     artifact?.operation!=='CONFIGURE_CUSTOMER_AUTH_ENV'||!Buffer.isBuffer(artifactBytes)||
     artifactBytes.length>256*1024||artifact.sha256!==sha(artifactBytes))fail('SIGNED_PRESERVATION_ARTIFACT_REQUIRED');
  let plan;try{plan=JSON.parse(artifactBytes.toString('utf8'));}catch{fail('PRESERVATION_PLAN_INVALID');}
  if(plan?.contract!=='P04_CUSTOMER_CREDENTIAL_PRESERVATION_V1'||plan.project_ref!==TARGET.project||
     plan.account_mode!=='legacy-preserved'||plan.reset_usage_epoch!==false||plan.preserve_v2!==true)
    fail('PRESERVATION_PLAN_INVALID');
  const baseline=validatePreservationSnapshot(plan.baseline),current=await readCustomerPreservation(io);
  if(current.security_sha256!==baseline.security_sha256)fail('CUSTOMER_SECURITY_CHANGED_RECONCILE_REQUIRED');
  for(let i=0;i<current.tables.length;i++){
    if(current.tables[i].row_count!==baseline.tables[i].row_count||current.tables[i].rowset_sha256!==baseline.tables[i].rowset_sha256)
      fail('CUSTOMER_DATA_OR_ALLOWANCE_CHANGED_RECONCILE_REQUIRED');
  }
  return {data_and_security_unchanged:true,project_ref:TARGET.project,table_count:PRESERVED_TABLES.length,
    authority_granted:false,backup_verified:false,production_cutover:false};
}
