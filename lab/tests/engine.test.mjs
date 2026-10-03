import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createLabServer, PIPELINE, DisconnectedAdapter } from '../server.mjs';

const offline = async () => { throw new Error('test offline'); };
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'thefa-lab-test-'));
  const runtimeDir = path.join(directory, 'runtime-state');
  const outputDir = path.join(directory, 'test-output');
  const settings = { runtimeDir, outputDir, stageDelayMs: 0, ollamaFetch: offline, ...options };
  let app;
  async function start() {
    app = await createLabServer(settings);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    app.base = `http://127.0.0.1:${app.server.address().port}`;
    return app;
  }
  await start();
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { get app() { return app; }, directory, runtimeDir, outputDir, restart: async () => { await app.close(); return start(); } };
}
async function request(app, route, body, extra = {}) {
  const response = await fetch(`${app.base}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
async function create(app, scenario = 'safe', rest = {}) {
  const response = await request(app, '/api/tasks', { title: `시험 ${scenario}`, scenario, idempotencyKey: `test-${scenario}-key`, ...rest });
  assert.equal(response.status, 201);
  await app.waitForIdle();
  return (await request(app, '/api/state')).data.tasks.find(task => task.id === response.data.task.id);
}

test('Local Canary: actual artifact, all stages and exact hash receipt agree', async t => {
  const f = await fixture(t);
  const task = await create(f.app);
  assert.equal(task.status, 'VERIFIED');
  assert.equal(task.mode, 'LOCAL');
  assert.deepEqual(task.events.filter(event => event.status === 'COMPLETED' || event.status === 'VERIFIED').map(event => event.stage), PIPELINE);
  assert.equal(task.qa.status, 'PASS');
  const state = (await request(f.app, '/api/state')).data;
  const artifact = state.artifacts.find(row => row.id === task.artifactId);
  const file = await fs.readFile(path.join(f.outputDir, artifact.name), 'utf8');
  const digest = createHash('sha256').update(file).digest('hex');
  const receipt = (await request(f.app, `/api/receipts/${task.receiptId}`)).data.receipt;
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(receipt.sha256, digest);
  assert.equal(task.qa.artifactSha256, digest);
  assert.equal(receipt.externalActions, 0);
  assert.match(file, /PASS: SHA-256/);
  assert.equal(state.memory.length, 1);
  assert.equal(state.environment.productionConnected, false);
  assert.equal(state.environment.enterpriseRouterConnected, false);
  assert.equal(state.usage.quotaSavings, null);
});

test('Concurrent duplicate requests create one task; changed payload conflicts', async t => {
  const f = await fixture(t);
  const body = { title: '동일 요청', scenario: 'safe', idempotencyKey: 'deduplicate-key-01' };
  const requests = await Promise.all(Array.from({ length: 8 }, () => request(f.app, '/api/tasks', body)));
  assert.equal(requests.filter(row => row.status === 201).length, 1);
  assert.equal(new Set(requests.map(row => row.data.task.id)).size, 1);
  await f.app.waitForIdle();
  const state = (await request(f.app, '/api/state')).data;
  assert.equal(state.tasks.length, 1); assert.equal(state.artifacts.length, 1); assert.equal(state.receipts.length, 1);
  const conflict = await request(f.app, '/api/tasks', { ...body, title: '다른 요청' });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error, 'IDEMPOTENCY_CONFLICT');
});

test('Approval Canary blocks output and resume; approve only local simulation', async t => {
  const f = await fixture(t);
  const task = await create(f.app, 'safe', { title: 'Production에 배포', idempotencyKey: 'approval-canary-01' });
  assert.equal(task.scenario, 'approval'); assert.equal(task.status, 'WAITING_APPROVAL');
  assert.equal(task.approval.scope, 'SANDBOX_SIMULATION_ONLY');
  assert.deepEqual(await fs.readdir(f.outputDir), []);
  const early = await request(f.app, `/api/tasks/${task.id}/resume`, {});
  assert.equal(early.status, 409); assert.equal(early.data.error, 'APPROVAL_REQUIRED');
  assert.equal((await request(f.app, `/api/tasks/${task.id}/approval`, { decision: 'approve' })).status, 200);
  await f.app.waitForIdle();
  const state = (await request(f.app, '/api/state')).data;
  const final = state.tasks[0]; assert.equal(final.status, 'VERIFIED');
  const artifact = await request(f.app, `/api/artifacts/${final.artifactId}`);
  assert.match(artifact.data, /SANDBOX_SIMULATION_ONLY/);
  assert.match(artifact.data, /배포·병합·DNS 변경은 수행하지 않았습니다/);
  assert.equal(state.receipts[0].externalActions, 0);
  await request(f.app, `/api/tasks/${task.id}/approval`, { decision: 'approve' });
  assert.equal(f.app.store.state.artifacts.length, 1);
});

test('Rejecting approval creates terminal receipt and no artifact', async t => {
  const f = await fixture(t); const task = await create(f.app, 'approval');
  const result = await request(f.app, `/api/tasks/${task.id}/approval`, { decision: 'reject' });
  assert.equal(result.data.task.status, 'REJECTED');
  assert.equal(f.app.store.state.receipts[0].status, 'REJECTED');
  assert.deepEqual(await fs.readdir(f.outputDir), []);
});

test('Failure Canary resumes exact checkpoint and preserves units across restart', async t => {
  const f = await fixture(t); const failed = await create(f.app, 'failure');
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.error, 'INJECTED_WORKER_FAILURE_ONCE');
  assert.equal(failed.checkpoint.nextStage, PIPELINE.indexOf('EXECUTION'));
  assert.equal(failed.currentStage, 'EXECUTION');
  const unitIds = failed.workUnits.map(row => row.id);
  await f.restart();
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => request(f.app, `/api/tasks/${failed.id}/resume`, {})));
  assert.ok(duplicates.every(row => row.status === 200));
  await f.app.waitForIdle();
  const final = f.app.store.state.tasks[0];
  assert.equal(final.status, 'VERIFIED'); assert.deepEqual(final.workUnits.map(row => row.id), unitIds);
  assert.equal(final.workUnits[0].attempts, 2); assert.equal(final.workUnits[1].attempts, 1);
  assert.equal(f.app.store.state.artifacts.length, 1);
  assert.equal(f.app.store.state.receipts.filter(row => row.status === 'FAILED').length, 1);
  assert.equal(f.app.store.state.receipts.filter(row => row.status === 'VERIFIED').length, 1);
});

test('Crash checkpoint recovers existing file without repeating provider execution', async t => {
  const f = await fixture(t); const completed = await create(f.app);
  await f.app.store.mutate(state => {
    const task = state.tasks[0]; task.status = 'RUNNING'; task.checkpoint.nextStage = PIPELINE.indexOf('EXECUTION');
    task.output = null; task.artifactId = null; task.receiptId = null; state.artifacts = []; state.receipts = []; state.memory = [];
  });
  await f.restart();
  assert.equal(f.app.store.state.tasks[0].status, 'PAUSED');
  f.app.adapters.local.execute = async () => { throw new Error('REPLAY_IS_FORBIDDEN'); };
  await request(f.app, `/api/tasks/${completed.id}/resume`, {}); await f.app.waitForIdle();
  const task = f.app.store.state.tasks[0]; assert.equal(task.status, 'VERIFIED');
  assert.ok(task.events.some(row => row.status === 'RECOVERED'));
  assert.equal((await fs.readdir(f.outputDir)).length, 1);
});

test('Mock failover receipt exposes both fake providers and no external claim', async t => {
  const f = await fixture(t); const task = await create(f.app, 'failover');
  assert.equal(task.status, 'VERIFIED'); assert.equal(task.mode, 'MOCK');
  assert.deepEqual(task.fallback, { from: 'Mock Provider A', to: 'Mock Provider B', reason: 'MOCK_PROVIDER_A_FAILURE', mode: 'MOCK' });
  const receipt = f.app.store.state.receipts[0]; assert.equal(receipt.mode, 'MOCK'); assert.equal(receipt.provider, 'Mock Provider B');
  const file = await request(f.app, `/api/artifacts/${task.artifactId}`);
  assert.match(file.data, /실제 조사, 외부 검색, 최신 정보 확인 또는 실제 업무를 수행하지 않았습니다/);
});

test('Unavailable local AI skips; existing model adapter can summarize without download', async t => {
  const f = await fixture(t); const skipped = await create(f.app, 'summary', { inputText: '요약 입력' });
  assert.equal(skipped.status, 'SKIPPED'); assert.equal(skipped.error, 'SKIPPED_LOCAL_AI_NOT_AVAILABLE');
  assert.equal(f.app.store.state.receipts[0].status, 'SKIPPED');
  assert.deepEqual(await fs.readdir(f.outputDir), []);
  const calls = [];
  const local = await fixture(t, { ollamaFetch: async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.endsWith('/tags') ? { models: [{ name: 'qwen2.5-coder:3b' }] } : { response: '첫 줄\n둘째 줄\n셋째 줄' }), { status: 200 });
  } });
  const task = await create(local.app, 'summary', { inputText: '안전한 테스트 입력' });
  assert.equal(task.status, 'VERIFIED'); assert.equal(task.selectedResource.provider, 'Ollama'); assert.equal(task.selectedResource.model, 'qwen2.5-coder:3b');
  assert.equal(task.qa.scope, 'OUTPUT_EXISTS_AND_INTEGRITY_ONLY');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(row => row.url.startsWith('http://127.0.0.1:11434/')));
  const body = JSON.parse(calls[1].init.body); assert.equal(body.stream, false); assert.equal(body.options.num_predict, 256);
  assert.ok(local.app.store.state.receipts[0].limitations.some(line => line.includes('미검증')));
});

test('HTTP boundaries reject cross-origin, forged host, secret paths, malformed/large bodies', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.app, '/api/state', undefined, { origin: 'https://evil.invalid' })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(`${f.app.base}/api/state`, { headers: { Host: 'evil.invalid' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await request(f.app, '/api/state', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
  for (const route of ['/.env', '/server.mjs', '/runtime-state/state.json', '/test-output/test.md', '/%2e%2e/server.mjs']) assert.equal((await request(f.app, route)).status, 404);
  const malformed = await fetch(`${f.app.base}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(malformed.status, 400);
  const oversized = await request(f.app, '/api/tasks', { title: 'x'.repeat(17000) }); assert.equal(oversized.status, 413);
  const wrongType = await fetch(`${f.app.base}/api/tasks`, { method: 'POST', body: '{}' }); assert.equal(wrongType.status, 415);
  assert.equal(f.app.store.state.tasks.length, 0);
});

test('Concurrent stale writer recovery admits exactly one new writer', async t => {
  const f = await fixture(t); await f.app.close();
  const processId = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
    child.on('error', reject); child.on('exit', () => resolve(child.pid));
  });
  await fs.writeFile(path.join(f.runtimeDir, 'writer.lock'), JSON.stringify({ pid: processId }));
  const contenders = await Promise.allSettled(Array.from({ length: 3 }, () => createLabServer({ runtimeDir: f.runtimeDir, outputDir: f.outputDir, ollamaFetch: offline })));
  const winners = contenders.filter(row => row.status === 'fulfilled');
  assert.equal(winners.length, 1);
  for (const row of contenders.filter(row => row.status === 'rejected')) assert.match(row.reason.message, /LOCAL_(WRITER_ALREADY_ACTIVE|LOCK_RECOVERY_BUSY)/);
  await winners[0].value.close();
});

test('Serving a tampered artifact fails integrity; same runtime forbids second writer', async t => {
  const f = await fixture(t); const task = await create(f.app);
  const artifact = f.app.store.state.artifacts[0];
  await fs.appendFile(path.join(f.outputDir, artifact.name), '\nTAMPERED\n');
  const response = await request(f.app, `/api/artifacts/${task.artifactId}`);
  assert.equal(response.status, 409); assert.equal(response.data.error, 'ARTIFACT_INTEGRITY_FAILED');
  await assert.rejects(createLabServer({ runtimeDir: f.runtimeDir, outputDir: f.outputDir, ollamaFetch: offline }), /LOCAL_WRITER_ALREADY_ACTIVE/);
  await assert.rejects(createLabServer({ host: '0.0.0.0' }), /LOOPBACK_ONLY/);
  const adapter = new DisconnectedAdapter('OpenAI');
  assert.equal((await adapter.health()).status, 'DISCONNECTED'); assert.equal(adapter.getReceipt(), null);
  await assert.rejects(adapter.execute(), /EXTERNAL_PROVIDER_DISCONNECTED/);
});
