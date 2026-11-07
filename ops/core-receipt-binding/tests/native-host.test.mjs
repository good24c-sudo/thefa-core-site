import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

let api;
try { api = await import('../native-host.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  api = {};
}
test('NativeHost normal connector exports are implemented', () => {
  assert.equal(typeof api.createNativeHost, 'function', 'NativeHost connector not implemented');
  assert.equal(typeof api.createGitHubCliIdentityVerifier, 'function');
});

function fixture(overrides = {}) {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const now=new Date('2026-10-29T10:00:00Z');
  const start='2026-10-29T09:59:00Z', end='2026-10-29T10:03:00Z';
  const personId='11111111-1111-4111-8111-111111111111';
  const sessionId='22222222-2222-4222-8222-222222222222';
  const grantId='33333333-3333-4333-8333-333333333333';
  const binding={scope:'P04:CUSTOMER:INITIAL_AUTH',payloadHash:'sha256:'+'a'.repeat(64),sourceRef:'codex-native:test-thread:test-human-message',operationKind:'INITIAL_AUTHENTICATION_CHALLENGE',approvalRef:'codex-native:test-thread:test-human-message',approvalHash:'sha256:'+'b'.repeat(64)};
  const fingerprint='sha256:'+createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  const context={databaseTime:now.toISOString(),
    person:{id:personId,status:'ACTIVE',provider:'github',subject:'123456',login:'test-owner'},
    session:{id:sessionId,kind:'NATIVE_HOST_SESSION',authMethod:'GITHUB_API_CURRENT_USER',provider:'github',subject:'123456',notBefore:start,expiresAt:end,revokedAt:null},
    grant:{id:grantId,kind:'REPRESENTATIVE_WRITER',personId,sessionId,scope:binding.scope,payloadHash:binding.payloadHash,sourceRef:binding.sourceRef,operationKind:binding.operationKind,approvalRef:binding.sourceRef,approvalHash:'sha256:'+'b'.repeat(64),notBefore:start,expiresAt:end,revokedAt:null},
    key:{id:'native-test-key',fingerprint,personId,grantId,actorRef:'actor_sha256:'+'c'.repeat(64),notBefore:start,expiresAt:end,revokedAt:null}};
  let identityCalls=0, contextCalls=0, consumeCalls=0;
  const consumed=new Set();
  const config={binding,publicKey,privateKey,keyId:context.key.id,
    now:()=>now,
    verifyApproval:async()=>({sourceKind:'CODEX_NATIVE_USER_MESSAGE',approvalRef:binding.approvalRef,approvalHash:binding.approvalHash,recordsMatched:1}),
    verifyIdentity:async()=>{identityCalls++;return {provider:'github',subject:'123456',login:'test-owner',verification:'GITHUB_API_CREDENTIAL_VALIDATED'};},
    readContext:async()=>{contextCalls++;return structuredClone(context);},
    consumeChallenge:async packet=>{consumeCalls++;if(consumed.has(packet.receipt.receipt_id))return {decision:'INITIAL_AUTH_CHALLENGE_REPLAY_REJECTED',consumed:false};consumed.add(packet.receipt.receipt_id);return {decision:'INITIAL_AUTH_CHALLENGE_CONSUMED',consumed:true,receiptId:packet.receipt.receipt_id,receiptHash:packet.receipt.receipt_hash,scope:binding.scope,payloadHash:binding.payloadHash,sourceRef:binding.sourceRef};},...overrides};
  return {config,context,binding,publicKey,privateKey,now,counts:()=>({identityCalls,contextCalls,consumeCalls})};
}

test('real cryptographic challenge is nonauthorizing and replay is rejected by durable consumer', async()=>{
  const f=fixture(),host=api.createNativeHost(f.config);
  const packet=await host.prepareReceipt();
  assert.equal(packet.proof.algorithm,'Ed25519');
  const verified=await host.verifyReceipt(packet);
  assert.equal(verified.native_session_verified,true);
  assert.equal(verified.representative_writer_grant_verified,true);
  assert.equal(verified.write_allowed,false);
  assert.equal(verified.nonce_consumed,false);
  const result=await host.consumeInitialChallenge(packet);
  assert.equal(result.authenticated,true);
  assert.equal(result.challenge_consumed,true);
  assert.equal(result.mutation_authority_granted,false);
  assert.equal(result.writer_registered,false);
  await assert.rejects(host.consumeInitialChallenge(packet),/INITIAL_AUTH_CHALLENGE_REPLAY_REJECTED/);
  assert.equal(f.counts().consumeCalls,2);
  assert.equal(f.counts().identityCalls,4);
});

for (const [name,mutate,code] of [
  ['wrong immutable credential principal',f=>f.config.verifyIdentity=async()=>({provider:'github',subject:'999',login:'test-owner',verification:'GITHUB_API_CREDENTIAL_VALIDATED'}),'IDENTITY_PERSON_MISMATCH'],
  ['inactive person',f=>f.context.person.status='DISABLED','ACTIVE_ENROLLED_PERSON_REQUIRED'],
  ['reader grant',f=>f.context.grant.kind='READER','REPRESENTATIVE_WRITER_GRANT_REQUIRED'],
  ['wrong session owner',f=>f.context.session.subject='999','NATIVE_SESSION_PRINCIPAL_MISMATCH'],
  ['expired session',f=>f.context.session.expiresAt='2026-10-29T09:59:59Z','NATIVE_SESSION_NOT_CURRENT'],
  ['revoked session',f=>f.context.session.revokedAt=f.now.toISOString(),'NATIVE_SESSION_NOT_CURRENT'],
  ['wrong session grant',f=>f.context.grant.sessionId='44444444-4444-4444-8444-444444444444','GRANT_PERSON_OR_SESSION_MISMATCH'],
  ['wrong source grant',f=>f.context.grant.sourceRef='different-human-source','GRANT_EXACT_BINDING_MISMATCH'],
  ['wrong command hash',f=>f.context.grant.payloadHash='sha256:'+'d'.repeat(64),'GRANT_EXACT_BINDING_MISMATCH'],
  ['wrong operation kind',f=>f.context.grant.operationKind='NORMAL_WRITE','GRANT_EXACT_BINDING_MISMATCH'],
  ['missing approval provenance',f=>f.context.grant.approvalHash='','SOURCE_APPROVAL_BINDING_REQUIRED'],
  ['revoked grant',f=>f.context.grant.revokedAt=f.now.toISOString(),'WRITER_GRANT_NOT_CURRENT'],
  ['revoked signing key',f=>f.context.key.revokedAt=f.now.toISOString(),'HOST_KEY_NOT_CURRENT'],
  ['wrong public key fingerprint',f=>f.context.key.fingerprint='sha256:'+'e'.repeat(64),'HOST_KEY_BINDING_MISMATCH'],
  ['wrong key person',f=>f.context.key.personId='44444444-4444-4444-8444-444444444444','HOST_KEY_BINDING_MISMATCH'],
  ['stale database context',f=>f.context.databaseTime='2026-10-29T09:59:00Z','TRUSTED_CONTEXT_TIME_INVALID'],
  ['different native approval source',f=>f.config.verifyApproval=async()=>({sourceKind:'CODEX_NATIVE_USER_MESSAGE',approvalRef:'wrong',approvalHash:f.binding.approvalHash,recordsMatched:1}),'NATIVE_APPROVAL_SOURCE_BINDING_MISMATCH'],
]) test(name+' cannot issue a signed receipt',async()=>{
  const f=fixture();mutate(f);const host=api.createNativeHost(f.config);
  await assert.rejects(host.prepareReceipt(),new RegExp(code));
  assert.equal(f.counts().consumeCalls,0);
});

test('tampered receipt is rejected before durable consume',async()=>{
  const f=fixture(),host=api.createNativeHost(f.config),packet=await host.prepareReceipt();
  packet.receipt.payload_hash='sha256:'+'d'.repeat(64);
  await assert.rejects(host.consumeInitialChallenge(packet),/RECEIPT_COMMAND_OR_ACTOR_BINDING_MISMATCH/);
  assert.equal(f.counts().consumeCalls,0);
});
test('private key mismatch cannot issue',()=>{
  const f=fixture();f.config.privateKey=generateKeyPairSync('ed25519').privateKey;
  assert.throws(()=>api.createNativeHost(f.config),/HOST_PRIVATE_PUBLIC_KEY_MISMATCH/);
});
test('normal scope cannot call initial challenge consumer',async()=>{
  const f=fixture();f.binding.operationKind='NORMAL_WRITE';f.context.grant.operationKind='NORMAL_WRITE';
  const host=api.createNativeHost(f.config),packet=await host.prepareReceipt();
  await assert.rejects(host.consumeInitialChallenge(packet),/INITIAL_AUTH_CHALLENGE_SCOPE_REQUIRED/);
  assert.equal(f.counts().consumeCalls,0);
});
test('unknown durable consume outcome does not retry',async()=>{
  let attempts=0;const f=fixture({consumeChallenge:async()=>{attempts++;throw new Error('sensitive transport output');}});
  const host=api.createNativeHost(f.config),packet=await host.prepareReceipt();
  await assert.rejects(host.consumeInitialChallenge(packet),/CHALLENGE_CONSUMPTION_OUTCOME_UNKNOWN/);
  assert.equal(attempts,1);
});
test('CLI verifier pins executable hash, immutable GitHub id and host without exposing credentials',async()=>{
  const bytes=await readFile(process.execPath);const hash=createHash('sha256').update(bytes).digest('hex');let calls=0;
  const verify=api.createGitHubCliIdentityVerifier({ghExecutable:process.execPath,executableSha256:hash,expectedSubject:'123456',expectedLogin:'test-owner',execFile:async(exe,args,opts)=>{calls++;assert.equal(exe,process.execPath);assert.deepEqual(args,['api','--hostname','github.com','user','--method','GET']);assert.equal(opts.shell,false);return {stdout:JSON.stringify({id:123456,login:'test-owner',type:'User'}),stderr:''};}});
  const result=await verify();assert.equal(result.subject,'123456');assert.equal(result.provider,'github');assert.equal(calls,1);assert.equal(JSON.stringify(result).includes('token'),false);
});
test('CLI verifier refuses changed binary before credential call',async()=>{
  let calls=0;const verify=api.createGitHubCliIdentityVerifier({ghExecutable:process.execPath,executableSha256:'0'.repeat(64),expectedSubject:'123456',expectedLogin:'test-owner',execFile:async()=>{calls++;return {stdout:'{}'};}});
  await assert.rejects(verify(),/PINNED_GITHUB_CLI_CHANGED/);assert.equal(calls,0);
});
test('CLI verifier refuses login match with different immutable id',async()=>{
  const hash=createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  const verify=api.createGitHubCliIdentityVerifier({ghExecutable:process.execPath,executableSha256:hash,expectedSubject:'123456',expectedLogin:'test-owner',execFile:async()=>({stdout:JSON.stringify({id:999,login:'test-owner',type:'User'})})});
  await assert.rejects(verify(),/GITHUB_PRINCIPAL_MISMATCH/);
});
