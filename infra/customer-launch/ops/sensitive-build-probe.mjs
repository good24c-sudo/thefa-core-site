import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PROOF_PREFIX,PROOF_TARGET,validateChallenge,validateProofDatabaseUrl,makeValueProof} from './sensitive-proof-contract.mjs';
import {DATABASE_CA} from '../app/server/inherited/server/auth/database-ca.mjs';
const require=createRequire(new URL('../app/package.json',import.meta.url));
const fail=code=>{throw Object.assign(new Error(code),{code});};

// No public route, migration, token export, Native signer or alias operation.
// The allowlisted verification-only build runs this file once. The existing
// provider must establish the signed scope, rollback and exclusive release first.
export async function runSensitiveBuildProbe({challenge,env=process.env,Client,now=()=>Date.now()}){
  validateChallenge(challenge,now());
  if(env.VERCEL!=='1'||env.VERCEL_PROJECT_ID!==PROOF_TARGET.project||env.VERCEL_TARGET_ENV!=='production'||
     !/^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID??''))fail('ACTUAL_VERCEL_BUILD_CONTEXT_REQUIRED');
  const value=env.CUSTOMER_AUTH_DATABASE_URL,url=validateProofDatabaseUrl(value);
  const PgClient=Client??require('pg').Client;
  const client=new PgClient({host:url.hostname,port:5432,database:'postgres',user:url.username,password:url.password,
    ssl:{ca:DATABASE_CA,rejectUnauthorized:true,servername:PROOF_TARGET.pooler},connectionTimeoutMillis:10000,query_timeout:10000,
    options:'-c default_transaction_read_only=on -c statement_timeout=10000'});
  let scram=false;
  client.connection.once('authenticationSASL',m=>{scram=m.mechanisms.includes('SCRAM-SHA-256')||m.mechanisms.includes('SCRAM-SHA-256-PLUS');});
  try{
    await client.connect();
    const r=await client.query("SELECT current_user AS role, current_database() AS database, current_setting('transaction_read_only') AS read_only");
    if(!scram||client.connection.stream.encrypted!==true||client.connection.stream.authorized!==true||
       r.rows.length!==1||r.rows[0].role!==PROOF_TARGET.role||r.rows[0].database!=='postgres'||r.rows[0].read_only!=='on')
      fail('ACTUAL_READ_ONLY_SCRAM_TLS_PROBE_REQUIRED');
    return makeValueProof({challenge,deploymentId:env.VERCEL_DEPLOYMENT_ID,observedAt:new Date(now()).toISOString(),databaseUrl:value});
  }finally{await client.end().catch(()=>{});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==3||!/^[A-Za-z0-9_-]{1,4096}$/.test(process.argv[2]))fail('EXACT_PUBLIC_CHALLENGE_ARGUMENT_REQUIRED');
    const challenge=JSON.parse(Buffer.from(process.argv[2],'base64url').toString('utf8'));
    const proof=await runSensitiveBuildProbe({challenge});
    await mkdir('proof-public');
    await writeFile('proof-public/index.html','<!doctype html><title>Verification</title><p>Verification only.</p>\n',{flag:'wx'});
    console.log(PROOF_PREFIX+JSON.stringify(proof));
  }catch(e){console.error(/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'SENSITIVE_BUILD_PROBE_FAILED');process.exitCode=1;}
}
