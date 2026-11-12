import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStageEdgeOidcIdentity} from '../server/oidc-stage-edge-auth.mjs';
const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1';
const subject='11111111-1111-4111-8111-111111111111';
const client='6b70d657-b1fa-4174-a3f2-29d475f4e3c0';
const env={VERCEL_ENV:'preview',THEFA_CORE_STAGE_EDGE_AUTH_READY:'true',
 THEFA_CORE_OIDC_ISSUER:issuer,THEFA_CORE_OIDC_CLIENT_ID:client};
const jwt='eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.'+'A'.repeat(100)+'.'+'B'.repeat(64);
const identity={issuer,subject,audience:client,accessToken:jwt};
const ok={contract:'THEFA_CORE_VERIFIED_OAUTH_IDENTITY_STAGE_V1',authenticated:true,issuer,
 clientId:client,subject,accountLinked:false,canUseAi:false,scope:'IDENTITY_ONLY'};
test('Core stage callback checks Edge token exactly and never grants AI',async()=>{
 let calls=0;
 const verified=await verifyStageEdgeOidcIdentity(identity,{env,fetchImpl:async(u,args)=>{
  calls++;
  assert.equal(u,'https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/thefa-core-customer-sso-stage');
  assert.equal(args.method,'GET');assert.equal(args.redirect,'error');
  assert.equal(args.headers.authorization,'Bearer '+jwt);
  assert.equal(args.headers.accept,'application/json');
  assert.equal('apikey' in args.headers,false);
  return Response.json(ok);
 }});
 assert.equal(calls,1);
 assert.deepEqual(verified,{sessionVerified:true,subject,accountLinked:false,canUseAi:false});
 assert.equal('accessToken' in verified,false);
});
test('other OAuth client and altered sub never reach the Edge endpoint',async()=>{
 let calls=0;
 const api=async()=>{calls++;return Response.json(ok)};
 await assert.rejects(verifyStageEdgeOidcIdentity({...identity,audience:'x'}, {env,fetchImpl:api}));
 await assert.rejects(verifyStageEdgeOidcIdentity({...identity,subject:'not-a-uuid'}, {env,fetchImpl:api}));
 await assert.rejects(verifyStageEdgeOidcIdentity({...identity,accessToken:'bad-token'}, {env,fetchImpl:api}));
 assert.equal(calls,0);
});
test('wrong issuer or production context cannot use preview Edges',async()=>{
 const api=async()=>{throw Error('MUST_NOT_CALL')};
 await assert.rejects(verifyStageEdgeOidcIdentity({...identity,issuer:'https://other.invalid'},{env,fetchImpl:api}));
 await assert.rejects(verifyStageEdgeOidcIdentity(identity,{env:{...env,VERCEL_ENV:'production'},fetchImpl:api}));
 await assert.rejects(verifyStageEdgeOidcIdentity(identity,{env:{...env,THEFA_CORE_STAGE_EDGE_AUTH_READY:'false'},fetchImpl:api}));
});
test('Edge identity without exact subject, client, or unsigned entitlement proof is rejected',async()=>{
 for(const body of [{...ok,subject:'22222222-2222-4222-8222-222222222222'},
  {...ok,clientId:'22222222-2222-4222-8222-222222222222'},
  {...ok,canUseAi:true},{...ok,accountLinked:true},{...ok,authenticated:false}]){
  await assert.rejects(verifyStageEdgeOidcIdentity(identity,{env,fetchImpl:async()=>Response.json(body)}));
 }
});
test('Edge 401 and 503 responses fail closed without local account admission',async()=>{
 for(const code of [401,403,503])await assert.rejects(verifyStageEdgeOidcIdentity(identity,{
  env,fetchImpl:async()=>Response.json({code:'INVALID'},{status:code})
 }));
});
test('Edge connectivity failure cannot be reported as authenticated',async()=>{
 await assert.rejects(verifyStageEdgeOidcIdentity(identity,{env,fetchImpl:async()=>{throw Error('network')}}));
});
