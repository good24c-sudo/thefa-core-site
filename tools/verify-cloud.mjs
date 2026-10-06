// Live private-beta canary. A temporary synthetic session verifies server contracts;
// it does not prove a human has received or entered a mailbox code. No mail is sent.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const origin='https://thefa-core-console.vercel.app';
const db=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const expectedHead=process.env.CORE_SOURCE_SHA,output=process.argv[2];
if(!db||!key||!output||!/^[a-f0-9]{40}$/.test(expectedHead||''))throw new Error('CANARY_CONFIGURATION_REQUIRED');
const sha=value=>createHash('sha256').update(value).digest('hex');
const token=randomBytes(32).toString('base64url'),tokenHash=sha(token);
const report={startedAt:new Date().toISOString(),sourceHead:expectedHead,identityProof:'SYNTHETIC_SESSION_CONTRACT_ONLY',mailboxLogin:'NOT_TESTED',mailSent:false,checks:{},canaries:{}};
async function dbRequest(method,body){const r=await fetch(db+'/rest/v1/core_console_sessions_v2'+(method==='DELETE'?'?token_hash=eq.'+tokenHash:''),{method,headers:{apikey:key,Authorization:'Bearer '+key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('CANARY_SESSION_DATABASE_FAILED');}
async function request(path,{body,cookie=false,postOrigin=origin}={}){return fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:'__Host-thefa_core_session='+token}:{}),...(body===undefined?{}:{'content-type':'application/json',Origin:postOrigin})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(35000)});}
async function api(path,body){const r=await request(path,{body,cookie:true});const value=await r.json();assert.ok(r.ok,`${path}: ${r.status} ${value.error||''}`);return value;}
async function task(scenario){return (await api('/api/tasks',{title:`연결 확인 · ${scenario} · Cloud 샌드박스 시험`,scenario,...(scenario==='summary'?{inputText:'Cloud에서는 PC의 Local AI가 연결되지 않았으므로 요약 실행을 건너뛰어야 합니다.'}:{}),idempotencyKey:`cloud-canary-${expectedHead}-${scenario}-v2`})).task;}
async function verifyArtifact(taskValue){const r=await request('/api/artifacts/'+taskValue.artifactId,{cookie:true});assert.equal(r.status,200);const text=await r.text();const receipt=(await api('/api/receipts/'+taskValue.receiptId)).receipt;assert.equal(receipt.sha256,sha(text));assert.equal(receipt.externalActions,0);assert.equal(receipt.mode,taskValue.mode);if(taskValue.mode==='MOCK'){assert.match(text,/예시 결과 — MOCK/);assert.match(text,/실제 조사.*실제 업무를 수행하지 않았습니다/);}else assert.match(text,/실제 업무나 외부 작업은 수행하지 않습니다/);return {taskId:taskValue.id,status:taskValue.status,mode:taskValue.mode,sha256:receipt.sha256,receiptId:receipt.id,externalActions:0};}
try{
  const login=await request('/login.html');assert.equal(login.status,200);assert.equal(login.headers.get('x-core-source'),expectedHead);assert.match(await login.text(),/간편가입|허가된/);assert.match(login.headers.get('content-security-policy'),/script-src 'self'/);report.checks.sourceAndLogin='PASS';
  const root=await request('/');assert.equal(root.status,303);assert.equal(root.headers.get('location'),'/login.html');
  for(const path of ['/api/state','/app.js','/styles.css','/api/artifacts/artifact_test'])assert.equal((await request(path)).status,401,path);
  assert.equal((await request('/auth/request-code',{body:{email:'outsider@example.invalid'}})).status,403);
  assert.equal((await request('/auth/request-code',{body:{email:'thefa@thefa.kr'},postOrigin:'https://unrelated.invalid'})).status,403);report.checks.anonymousAndOutsideEmail='PASS';
  await dbRequest('POST',{token_hash:tokenHash,email:'thefa@thefa.kr',expires_at:new Date(Date.now()+300000).toISOString()});
  let state=await api('/api/state');assert.equal(state.auth.email,'thefa@thefa.kr');assert.equal(state.environment.businessProductionConnected,false);assert.equal(state.environment.executionLocation,'Cloud');report.checks.privateState='PASS';
  for(const pending of state.tasks.filter(t=>t.title==='배포 검증 · safe · Cloud 샌드박스 시험'&&t.scenario==='safe'&&t.status==='WAITING_APPROVAL')){const rejected=(await api(`/api/tasks/${pending.id}/approval`,{decision:'reject'})).task;assert.equal(rejected.status,'REJECTED');report.canaries.deploymentKeywordGuard={taskId:pending.id,status:rejected.status,artifactCreated:false};}
  const safe=await task('safe');assert.equal(safe.status,'VERIFIED');assert.equal(safe.mode,'REAL');assert.equal(safe.selectedResource.provider,'Node Cloud Sandbox');report.canaries.safe=await verifyArtifact(safe);
  const duplicate=await task('safe');assert.equal(duplicate.id,safe.id);report.checks.idempotency='PASS';
  let approval=await task('approval');if(approval.status==='WAITING_APPROVAL'){assert.ok(!approval.artifactId);const attempt=await request(`/api/tasks/${approval.id}/resume`,{cookie:true,body:{}});assert.equal(attempt.status,409);approval=(await api(`/api/tasks/${approval.id}/approval`,{decision:'approve'})).task;}assert.equal(approval.status,'VERIFIED');report.canaries.approvalSimulation=await verifyArtifact(approval);
  let failed=await task('failure');if(failed.status==='FAILED_RETRYABLE'||failed.status==='FAILED')failed=(await api(`/api/tasks/${failed.id}/resume`,{})).task;assert.equal(failed.status,'VERIFIED');report.canaries.checkpointResume=await verifyArtifact(failed);
  const failover=await task('failover');assert.equal(failover.status,'VERIFIED');assert.equal(failover.mode,'MOCK');report.canaries.mockFailover=await verifyArtifact(failover);
  const summary=await task('summary');assert.equal(summary.status,'SKIPPED');report.canaries.pcSummary={taskId:summary.id,status:summary.status,reason:'PC Local AI not connected; execution skipped'};
  state=await api('/api/state');assert.equal(state.tasks.find(t=>t.id===safe.id).status,'VERIFIED');report.checks.crossRequestPersistence='PASS';
  assert.equal((await request('/auth/logout',{cookie:true,body:{}})).status,200);assert.equal((await request('/api/state',{cookie:true})).status,401);report.checks.logoutRevocation='PASS';report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;throw error;}
finally{try{await dbRequest('DELETE');report.syntheticSessionDeleted=true;}catch{report.syntheticSessionDeleted=false;}report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,canaries:report.canaries,syntheticSessionDeleted:report.syntheticSessionDeleted}));}
