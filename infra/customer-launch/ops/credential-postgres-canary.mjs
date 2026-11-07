// Explicit isolated integration QA. Never uses a configured remote database.
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {credentialSql,ROLE_READBACK} from './credential-host.mjs';
import {PRESERVED_TABLES,PRESERVATION_SQL,validatePreservationSnapshot} from './preservation-readback.mjs';
const image=process.argv[2];
if(!/^[a-f0-9]{12,64}$/.test(image??''))throw Error('EXISTING_LOCAL_POSTGRES17_IMAGE_ID_REQUIRED');
const name='thefa-p04-stage2-canary-'+randomUUID();
const run=(args,input='')=>spawnSync('docker',args,{input,encoding:'utf8',timeout:30000,windowsHide:true});
const sql=text=>{const r=run(['exec','-i',name,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],text);
  if(r.status!==0)throw Error('ISOLATED_SQL_FAILED');return r.stdout.trim();};
let created=false,checks=0;
try{
  assert.equal(run(['image','inspect',image]).status,0);
  const start=run(['run','-d','--rm','--name',name,'--network','none','--memory','256m','--cpus','1',
    '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=192m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
  assert.equal(start.status,0);created=true;
  for(let i=0;i<40;i++){if(run(['exec',name,'pg_isready','-U','postgres']).status===0)break;
    await new Promise(r=>setTimeout(r,250));}
  assert.match(sql('SHOW server_version;'),/^17\./);checks++;
  const inspect=JSON.parse(run(['inspect',name]).stdout)[0];
  assert.equal(inspect.HostConfig.NetworkMode,'none');assert.deepEqual(inspect.NetworkSettings.Ports,{});checks++;
  sql('CREATE ROLE core_customer_auth_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE TABLE preserved_usage (used integer); INSERT INTO preserved_usage VALUES (10);');
  sql('CREATE SCHEMA core_customer_auth;'+PRESERVED_TABLES.map(name=>{
    const [schema,table]=name.split('.');return `CREATE TABLE "${schema}"."${table}" (payload jsonb);`;
  }).join('')+`INSERT INTO public.core_console_state_v2 VALUES ('{"customer":"isolated-test","used":10}');`);
  const snapshot=()=>validatePreservationSnapshot(JSON.parse(sql(PRESERVATION_SQL)));
  const before=snapshot();assert.equal(before.tables.find(r=>r.table_name==='public.core_console_state_v2').row_count,1);checks++;
  const password=randomBytes(48).toString('base64url');sql(credentialSql(password));
  const role=JSON.parse(sql(ROLE_READBACK));assert.equal(role.password_null,false);assert.equal(role.scram,true);
  assert.equal(role.superuser,false);assert.equal(role.bypass_rls,false);assert.equal(role.create_role,false);checks++;
  assert.deepEqual(snapshot(),before);checks++; // Only the authorized password changed.
  assert.equal(sql('SELECT used FROM preserved_usage;'),'10');checks++;
  assert.throws(()=>sql(credentialSql(randomBytes(48).toString('base64url'))),/ISOLATED_SQL_FAILED/);checks++;
  // Force SCRAM for TCP inside this network-none container; no host port exists.
  const hba=run(['exec','-i',name,'sh','-c','cat > "$PGDATA/pg_hba.conf"'],
    'local all all trust\nhost all all 127.0.0.1/32 scram-sha-256\n');assert.equal(hba.status,0);
  sql('SELECT pg_reload_conf();');await new Promise(r=>setTimeout(r,150));
  const login=value=>run(['exec','-i',name,'sh','-c',
    'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -h 127.0.0.1 -U core_customer_auth_runtime -d postgres -v ON_ERROR_STOP=1 -At -c "SELECT current_user"'],value+'\n');
  const correct=login(password);assert.equal(correct.status,0);assert.equal(correct.stdout.trim(),'core_customer_auth_runtime');checks++;
  assert.notEqual(login(randomBytes(48).toString('base64url')).status,0);checks++;
  sql(`UPDATE public.core_console_state_v2 SET payload='{"customer":"isolated-test","used":0}';`);
  const changed=snapshot();assert.equal(changed.tables[6].row_count,before.tables[6].row_count);
  assert.notEqual(changed.tables[6].rowset_sha256,before.tables[6].rowset_sha256);checks++;
  sql('GRANT SELECT ON public.core_console_state_v2 TO PUBLIC;');
  const acl=snapshot();assert.notEqual(acl.security_sha256,changed.security_sha256);checks++;
  sql('ALTER TABLE public.core_console_state_v2 ENABLE ROW LEVEL SECURITY;');
  assert.notEqual(snapshot().security_sha256,acl.security_sha256);checks++;
  console.log(JSON.stringify({kind:'ISOLATED_POSTGRES17_CANARY',checks,passed:checks,network:'none',ports:0,
    real_scram_password_login:true,tls_tested:false,production_effects:0,source_sql:'credentialSql',image}));
}finally{if(created)run(['stop','--time','1',name]);}
