import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {TARGET,create4060IO} from './credential-io.mjs';
import {DATABASE_CA} from '../app/server/inherited/server/auth/database-ca.mjs';

const require=createRequire(new URL('../app/package.json',import.meta.url));
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const SHA=/^sha256:[a-f0-9]{64}$/;
const POOLER='aws-0-ap-northeast-2.pooler.supabase.com';
const KEY='CUSTOMER_AUTH_DATABASE_URL';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const envEndpoint='/v10/projects/'+TARGET.vercel+'/env?teamId='+TARGET.team+'&decrypt=true';

export function requireClaimBinding(reserved,claim,now=Date.now()) {
  if(reserved?.decision!=='NEW_EXCLUSIVE_ATTEMPT'||claim?.decision!=='WORKER_CLAIMED'||
     !UUID.test(reserved?.attempt_id??'')||!UUID.test(reserved?.action_id??'')||
     !UUID.test(reserved?.claim_id??'')||!/^dcjob-[a-f0-9]{24}$/.test(reserved?.work_unit_id??'')||
     reserved.work_unit_id==='dcjob-69194412b00b2b45a2d50c91'||
     !SHA.test(reserved.provider_request_hash??'')||!SHA.test(reserved.request_binding_hash??'')||
     !SHA.test(reserved.admission_receipt_hash??'')||!UUID.test(reserved.receipt_id??'')||
     !Number.isFinite(Date.parse(claim?.expires_at))||Date.parse(claim.expires_at)<=now+5000||
     claim.manifest?.supabase_project_ref!==TARGET.project||claim.manifest?.vercel_project_id!==TARGET.vercel||
     claim.manifest?.environment!=='PRODUCTION'||claim.manifest?.origin!=='https://thefacore.com'||
     claim.manifest?.preserve_data!==true||claim.manifest?.reset_usage_epoch!==false||claim.manifest?.replay_original_job!==false||
     JSON.stringify(claim.manifest?.operations)!=='["CONFIGURE_CUSTOMER_AUTH_ENV"]'||
     claim.manifest?.protected_session_id!=='111c339990e7926f4e8b226e')fail('EXACT_LIVE_STAGE2_CLAIM_REQUIRED');
  for(const key of ['attempt_id','receipt_id','action_id','claim_id','work_unit_id','provider_request_hash','provider_operation_id','request_binding_hash','admission_receipt_hash','expires_at'])
    if(!reserved[key]||reserved[key]!==claim[key])fail('LIVE_CLAIM_BINDING_MISMATCH');
  return claim;
}

// Values remain process-private. No secret value or value hash is returned.
export function requireCoherentEnvironment(response) {
  if(!Array.isArray(response?.envs)||response.pagination?.next)fail('COMPLETE_VERCEL_ENV_READBACK_REQUIRED');
  const entries=response.envs.filter(e=>Array.isArray(e.target)&&e.target.includes('production'));
  // Sensitive values cannot be retrieved after saving. Do not downgrade them,
  // mistake redacted metadata for a secret, or change the DB role before a
  // supported deployment-runtime proof and coherent release are available.
  if(entries.some(e=>e.type==='sensitive'||e.type==='secret'))
    fail('SENSITIVE_ENV_RUNTIME_PROOF_AND_COHERENT_RELEASE_REQUIRED');
  const values={};
  for(const entry of entries){
    if(typeof entry.key!=='string'||Object.hasOwn(values,entry.key)||typeof entry.value!=='string'||entry.gitBranch)
      fail('AMBIGUOUS_OR_UNREADABLE_VERCEL_ENV');
    values[entry.key]=entry.value;
  }
  if(values.CUSTOMER_ENVIRONMENT!=='production'||values.CUSTOMER_SUPABASE_URL!=='https://'+TARGET.project+'.supabase.co'||
     values.CUSTOMER_ORIGIN!=='https://thefacore.com'||(values.CUSTOMER_ACCOUNT_MODE??'legacy-preserved')!=='legacy-preserved'||
     values.CUSTOMER_REDIRECTS_READY!=='true'||values.NODEJS_HELPERS!=='0')fail('ATOMIC_PRODUCTION_ENV_RELEASE_REQUIRED');
  const previous=entries.find(e=>e.key===KEY);
  if(previous&&(previous.target.length!==1||previous.type!=='encrypted'))fail('DATABASE_ENV_SCOPE_OR_TYPE_MISMATCH');
  return entries;
}

export const ROLE_READBACK=`SELECT jsonb_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,
 'bypass_rls',rolbypassrls,'create_db',rolcreatedb,'create_role',rolcreaterole,'replication',rolreplication,
 'password_null',rolpassword IS NULL,'scram',COALESCE(rolpassword LIKE 'SCRAM-SHA-256$%',false)) AS role
 FROM pg_catalog.pg_authid WHERE rolname='core_customer_auth_runtime';`;
function requireRole(rows,configured=false){
  const r=rows?.[0]?.role;
  if(rows?.length!==1||r?.name!==TARGET.role||r.login!==true||r.superuser!==false||r.bypass_rls!==false||
     r.create_db!==false||r.create_role!==false||r.replication!==false||r.password_null!==!configured||r.scram!==configured)
    fail('RUNTIME_ROLE_PRECONDITION_MISMATCH');
}
export function credentialSql(password){
  if(!/^[A-Za-z0-9_-]{64}$/.test(password))fail('INVALID_GENERATED_CREDENTIAL');
  // The only mutable statement is a password for the preexisting exact role.
  // The guard is in the same transaction; no schema, memberships or ACL changes.
  return `BEGIN; SET LOCAL password_encryption='scram-sha-256';
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_authid WHERE rolname='core_customer_auth_runtime'
 AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolpassword IS NULL)
 THEN RAISE EXCEPTION 'RUNTIME_ROLE_PRECONDITION_MISMATCH'; END IF; END $guard$;
ALTER ROLE core_customer_auth_runtime PASSWORD '${password}'; COMMIT;`;
}
function databaseUrl(password){return 'postgresql://'+TARGET.role+'.'+TARGET.project+':'+password+'@'+POOLER+':5432/postgres?sslmode=verify-full';}

async function probeRuntime(password){
  const {Client}=require('pg');
  const client=new Client({host:POOLER,port:5432,database:'postgres',user:TARGET.role+'.'+TARGET.project,password,
    ssl:{ca:DATABASE_CA,rejectUnauthorized:true,servername:POOLER},connectionTimeoutMillis:10000,query_timeout:10000});
  let scram=false;
  client.connection.once('authenticationSASL',m=>{scram=m.mechanisms.includes('SCRAM-SHA-256')||m.mechanisms.includes('SCRAM-SHA-256-PLUS');});
  try{
    await client.connect();
    const result=await client.query('SELECT current_user AS role');
    if(!scram||client.connection.stream.encrypted!==true||client.connection.stream.authorized!==true||result.rows[0]?.role!==TARGET.role)
      fail('ACTUAL_SCRAM_TLS_LOGIN_REQUIRED');
  }finally{await client.end().catch(()=>{});}
}

/** Physical methods only, composed into the existing installed Broker worker.
 * No admission, issuer, WORKER_CLAIM, dispatch, receipt signing or deployment.
 * readLiveClaim MUST call the authenticated Broker, not return caller JSON.
 * assertPreservation MUST verify signed backup/rollback, exact source, lease,
 * data/usage/RLS/ACL readback and release exclusion using the owner integration.
 * Neither callback is supplied by this module; no standalone production CLI.
 */
export function createCredentialMethods({io,readLiveClaim,assertPreservation,probe=probeRuntime}) {
  if(!io||typeof readLiveClaim!=='function'||typeof assertPreservation!=='function')fail('INSTALLED_BROKER_INTEGRATION_REQUIRED');
  const attempts=new Map();
  const live=async reserved=>{const claim=requireClaimBinding(reserved,await readLiveClaim(reserved));
    await assertPreservation({reserved,claim});return claim;};
  const get=async(reserved,opaque,expected)=>{
    await live(reserved);const item=attempts.get(reserved.attempt_id);
    if(!item||item.reservedHash!==digest(reserved)||opaque?.kind!=='HOST_DPAPI_SECRET_HANDLE'||
       opaque.handle_id!==reserved.attempt_id||JSON.stringify(Object.keys(opaque).sort())!=='["handle_id","kind"]'||
       item.phase!==expected)fail('EXISTING_ATTEMPT_RECONCILE_ONLY');
    item.phase='IN_PROGRESS';return item;
  };
  const secret=async reserved=>{
    const raw=await io.vault(reserved.attempt_id+'.secret.dpapi','Read');
    let value;try{value=JSON.parse(raw);}catch{fail('VAULT_PAYLOAD_INVALID');}
    if(value.binding!==digest(reserved)||!/^[A-Za-z0-9_-]{64}$/.test(value.password))fail('VAULT_BINDING_MISMATCH');
    return value.password;
  };
  return Object.freeze({
    async stageDpapiSecretHandle(reserved){
      await live(reserved);if(attempts.has(reserved.attempt_id))fail('EXISTING_ATTEMPT_RECONCILE_ONLY');
      const project=await io.vercel('/v9/projects/'+TARGET.vercel+'?teamId='+TARGET.team);
      if(project.id!==TARGET.vercel||project.accountId!==TARGET.team)fail('VERCEL_PROJECT_IDENTITY_MISMATCH');
      requireRole(await io.query(ROLE_READBACK));
      const env=await io.vercel(envEndpoint);requireCoherentEnvironment(env);
      // Exclusive durable intent is never overwritten, even after process death.
      await io.vault(reserved.attempt_id+'.intent.dpapi','WriteNew',JSON.stringify(reserved));
      await io.vault(reserved.attempt_id+'.rollback.dpapi','WriteNew',JSON.stringify({env,project,previous_role_password:null}));
      const password=randomBytes(48).toString('base64url');
      await io.vault(reserved.attempt_id+'.secret.dpapi','WriteNew',JSON.stringify({binding:digest(reserved),password}));
      attempts.set(reserved.attempt_id,{reservedHash:digest(reserved),phase:'STAGED',envHash:digest(env)});
      return {kind:'HOST_DPAPI_SECRET_HANDLE',handle_id:reserved.attempt_id};
    },
    async setRuntimeRolePasswordUsingHandle(reserved,opaque){
      const item=await get(reserved,opaque,'STAGED');item.phase='UNCERTAIN';
      await io.query(credentialSql(await secret(reserved)));
      requireRole(await io.query(ROLE_READBACK),true);await live(reserved);
      item.phase='PASSWORD_SET';return {decision:'PRODUCTION_ROLE_PASSWORD_SET'};
    },
    async verifyRuntimeLoginUsingHandle(reserved,opaque){
      const item=await get(reserved,opaque,'PASSWORD_SET');item.phase='UNCERTAIN';
      await probe(await secret(reserved));
      let rejected=false;try{await probe(randomBytes(48).toString('base64url'));}catch(e){rejected=e?.code==='28P01';}
      if(!rejected)fail('WRONG_PASSWORD_REJECTION_REQUIRED');
      item.phase='LOGIN_VERIFIED';return {decision:'RUNTIME_LOGIN_VERIFIED_CUSTOM_ROLE'};
    },
    async setVercelDatabaseUrlFromHandle(reserved,opaque){
      const item=await get(reserved,opaque,'LOGIN_VERIFIED');item.phase='UNCERTAIN';
      const current=await io.vercel(envEndpoint);requireCoherentEnvironment(current);
      if(digest(current)!==item.envHash)fail('VERCEL_ENV_CHANGED_RECONCILE_REQUIRED');
      const value=databaseUrl(await secret(reserved));
      await io.vercel('/v10/projects/'+TARGET.vercel+'/env?teamId='+TARGET.team+'&upsert=true','POST',
        {key:KEY,type:'encrypted',target:['production'],value});
      // A successful POST alone never earns the method's success result.
      const env=await io.vercel(envEndpoint),entries=requireCoherentEnvironment(env),entry=entries.find(e=>e.key===KEY);
      if(entry?.value!==value||entry.type!=='encrypted'||entry.target.length!==1)fail('VERCEL_WRITE_READBACK_REQUIRED');
      item.phase='VERCEL_SET';return {decision:'VERCEL_DATABASE_SECRET_APPLIED_ENCRYPTED'};
    },
    async readbackVercelServerSide(reserved,opaque){
      const item=await get(reserved,opaque,'VERCEL_SET');
      const entries=requireCoherentEnvironment(await io.vercel(envEndpoint)),entry=entries.find(e=>e.key===KEY);
      const expected=Buffer.from(databaseUrl(await secret(reserved))),actual=Buffer.from(entry?.value??'');
      if(entry?.type!=='encrypted'||entry.target.length!==1||actual.length!==expected.length||!timingSafeEqual(actual,expected))
        fail('VERCEL_SECRET_VALUE_READBACK_MISMATCH');
      requireRole(await io.query(ROLE_READBACK),true);await live(reserved);
      item.phase='READBACK_VERIFIED';return {decision:'APP_DATABASE_SECRET_MATCHED_WITHOUT_DISCLOSURE'};
    }
  });
}

export const create4060CredentialMethods=options=>createCredentialMethods({...options,io:create4060IO(),probe:probeRuntime});
