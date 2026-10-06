// Exercise the real loopback server; preserve terminal evidence outside the public site.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4173';
const outputDirectory = process.argv[2];
const productDirectory = process.argv[3];
if (!outputDirectory || !productDirectory) throw new Error('Usage: node tools/run-local-canaries.mjs <evidence-directory> <console-directory>');
const report = { startedAt: new Date().toISOString(), source: 'LIVE_LOOPBACK_HTTP', canaries: {} };

async function api(route, body) {
  const response = await fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', Origin: origin } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

async function waitForTask(id, statuses, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await api('/api/state');
    const task = state.tasks.find(item => item.id === id);
    assert.ok(task, 'Task exists in persisted state');
    if (statuses.includes(task.status)) return { task, state };
    if (['FAILED', 'BLOCKED'].includes(task.status)) throw new Error(JSON.stringify(task));
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Task ${id}: terminal receipt deadline exceeded`);
}

async function create(title, scenario, extra = {}) {
  const key = 'v2-canary-' + randomUUID();
  const request = { title, scenario, idempotencyKey: key, ...extra };
  const first = await api('/api/tasks', request);
  const second = await api('/api/tasks', request);
  assert.equal(first.task.id, second.task.id, 'Idempotency prevents duplicate task admission');
  return first.task;
}

async function verifyArtifact(task, state) {
  const artifact = state.artifacts.find(item => item.id === task.artifactId);
  const receipt = state.receipts.find(item => item.id === task.receiptId);
  assert.ok(artifact, 'An actual artifact record exists');
  assert.ok(receipt, 'A terminal receipt exists');
  const download = await fetch(origin + '/api/artifacts/' + artifact.id);
  assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.ok(bytes.length > 20, 'Report has actual content');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const receiptResponse = await api('/api/receipts/' + receipt.id);
  const terminal = receiptResponse.receipt || receiptResponse;
  assert.equal(terminal.status, 'VERIFIED');
  assert.equal(terminal.qaStatus, 'PASS');
  assert.equal(terminal.sha256, hash, 'Receipt hash matches downloaded artifact');
  assert.equal(terminal.externalActions, 0);
  assert.equal(task.qa.status, 'PASS');
  return { artifact, receipt: receiptResponse, sha256: hash, downloadedBytes: bytes.length };
}

async function run(name, action) {
  try {
    report.canaries[name] = { status: 'PASS', ...await action() };
  } catch (error) {
    report.canaries[name] = { status: 'FAIL', error: error.stack };
  }
  console.log(name + ': ' + report.canaries[name].status);
}

await run('task_flow', async () => {
  const task = await create('THE FA Core 테스트 보고서를 만들어줘', 'safe');
  const result = await waitForTask(task.id, ['VERIFIED']);
  const evidence = await verifyArtifact(result.task, result.state);
  // The named artifact must be a file on the actual new V2 product directory.
  const file = path.join(productDirectory, 'test-output', evidence.artifact.name);
  const disk = await readFile(file);
  assert.equal(createHash('sha256').update(disk).digest('hex'), evidence.sha256);
  return { task: result.task, evidence, file };
});

await run('approval', async () => {
  const task = await create('Production에 배포', 'approval');
  const waiting = await waitForTask(task.id, ['WAITING_APPROVAL']);
  assert.equal(waiting.state.artifacts.filter(item => item.taskId === task.id).length, 0,
    'Dangerous action cannot produce an execution artifact before approval');
  await api('/api/tasks/' + task.id + '/approval', { decision: 'approve' });
  const result = await waitForTask(task.id, ['VERIFIED']);
  const evidence = await verifyArtifact(result.task, result.state);
  assert.equal(result.task.mode, 'LOCAL');
  const approvalText = await (await fetch(origin + '/api/artifacts/' + evidence.artifact.id)).text();
  assert.ok(approvalText.includes('SANDBOX_SIMULATION_ONLY'));
  return { task: result.task, evidence, productionAction: 'NEVER_EXECUTED_LOCAL_SIMULATION_ONLY' };
});

await run('failure_resume', async () => {
  const task = await create('실패한 Worker를 이어서 실행해줘', 'failure');
  const failed = await waitForTask(task.id, ['FAILED']);
  assert.equal(failed.task.error, 'INJECTED_WORKER_FAILURE_ONCE');
  assert.ok(failed.task.checkpoint, 'A checkpoint survives worker failure');
  const before = JSON.parse(JSON.stringify(failed.task));
  assert.ok(before.workUnits.length > 0);
  assert.ok(before.events.some(item => item.stage === 'PLAN'));
  await api('/api/tasks/' + task.id + '/resume', {});
  const result = await waitForTask(task.id, ['VERIFIED']);
  assert.equal(result.task.id, before.id);
  assert.deepEqual(result.task.workUnits.map(item => item.id), before.workUnits.map(item => item.id));
  assert.equal(result.task.events.filter(item => item.stage === 'PLAN').length,
    before.events.filter(item => item.stage === 'PLAN').length,
    'Resume does not replay planning');
  assert.equal(result.state.tasks.filter(item => item.id === task.id).length, 1);
  return { checkpointBefore: before.checkpoint, task: result.task,
    evidence: await verifyArtifact(result.task, result.state) };
});

await run('mock_provider_failover', async () => {
  const task = await create('모의 제공자 A 장애 후 B로 이어서 실행', 'failover');
  const result = await waitForTask(task.id, ['VERIFIED']);
  assert.equal(result.task.mode, 'MOCK');
  assert.equal(result.task.selectedResource.provider, 'Mock Provider B');
  assert.equal(result.task.fallback.from, 'Mock Provider A');
  return { task: result.task, evidence: await verifyArtifact(result.task, result.state),
    providerMode: 'MOCK_NO_PAID_PROVIDER_CALLS' };
});

const environment = await api('/api/state');
const availableLocal = environment.resources.some(item => item.provider === 'Ollama' && item.status === 'CONNECTED');
if (availableLocal) {
  await run('local_ai', async () => {
    const task = await create('이 텍스트를 세 줄로 요약: THE FA Core는 목표를 이해하고, 적합한 자원을 선택하고, 실제 결과물을 만든 뒤 QA로 검증하며 결정과 결과를 기억합니다.', 'summary', {
      inputText: 'THE FA Core는 목표를 이해합니다. 적합한 자원을 선택하고 실제 결과물을 만듭니다. QA로 검증하고 결정과 결과를 기억합니다.'
    });
    const result = await waitForTask(task.id, ['VERIFIED'], 120000);
    assert.equal(result.task.mode, 'LOCAL');
    assert.equal(result.task.selectedResource.provider, 'Ollama');
    assert.equal(result.task.selectedResource.executionLocation, 'PC');
    return { task: result.task, evidence: await verifyArtifact(result.task, result.state) };
  });
} else {
  report.canaries.local_ai = { status: 'SKIPPED', reason: 'SKIPPED_LOCAL_AI_NOT_AVAILABLE', resources: environment.resources.filter(item => item.type === 'LOCAL') };
  console.log('local_ai: SKIPPED');
}

report.completedAt = new Date().toISOString();
report.status = Object.values(report.canaries).some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS';
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'local-canaries.json'), JSON.stringify(report, null, 2));
console.log('TERMINAL_RECEIPT ' + path.join(outputDirectory, 'local-canaries.json'));
process.exitCode = report.status === 'FAIL' ? 1 : 0;
