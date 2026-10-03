import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { executeApi } from '../engine-adapter.mjs';
import { createCloudPersistence, SupabaseRest, SupabaseStateStore } from '../store.mjs';

const hash = content => createHash('sha256').update(content).digest('hex');
const blank = () => ({ version: 2, tasks: [], artifacts: [], receipts: [], memory: [], idempotency: {} });

function database() {
  const db = { state: null, version: 0, lease_owner: null, lease_until: 0, artifacts: new Map(), calls: [] };
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const error = message => response({ code: 'P0001', message }, 409);
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(url); const name = parsed.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : null;
    db.calls.push({ name, method: init.method || 'GET', body });
    assert.equal(parsed.origin, 'https://test-project.supabase.co');
    assert.equal(init.headers.apikey, 'test-server-key');
    if (name === 'core_console_state_v2') return response([{ state: structuredClone(db.state), version: db.version, lease_owner: db.lease_owner, lease_until: new Date(db.lease_until).toISOString() }]);
    if (name === 'core_console_artifacts_v2') { const row = db.artifacts.get(parsed.searchParams.get('name').replace(/^eq\./, '')); return response(row ? [row] : []); }
    if (name === 'rpc/core_console_acquire_lease_v2') {
      const expired = db.lease_until <= Date.now();
      if (db.lease_owner && db.lease_owner !== body.p_owner && !expired) return response({ granted: false });
      const recovered = !!db.lease_owner && expired && db.lease_owner !== body.p_owner;
      db.lease_owner = body.p_owner; db.lease_until = Date.now() + body.p_seconds * 1000;
      return response({ granted: true, state: structuredClone(db.state), version: db.version, lease_owner: db.lease_owner, lease_until: new Date(db.lease_until).toISOString(), recovered });
    }
    const ownerValid = db.lease_owner === body?.p_owner && db.lease_until > Date.now();
    if (name === 'rpc/core_console_save_state_v2') {
      if (!ownerValid) return error('LEASE_LOST');
      if (db.takeoverWhenWorkerStarts && body.p_state.tasks.some(task => task.status === 'RUNNING')) { db.takeoverWhenWorkerStarts = false; db.lease_owner = randomUUID(); db.lease_until = Date.now() + 120000; return error('LEASE_LOST'); }
      if (db.conflictNextSave) { db.conflictNextSave = false; db.version += 1; }
      if (db.version !== body.p_expected_version) return error('VERSION_CONFLICT');
      db.state = structuredClone(body.p_state); db.version += 1; return response({ version: db.version });
    }
    if (name === 'rpc/core_console_release_lease_v2') {
      if (db.lease_owner === body.p_owner) { db.lease_owner = null; db.lease_until = 0; }
      return response({ released: true });
    }
    if (name === 'rpc/core_console_put_artifact_v2') {
      if (!ownerValid) return error('LEASE_LOST');
      if (hash(body.p_content) !== body.p_sha256) return error('ARTIFACT_SHA_MISMATCH');
      const old = db.artifacts.get(body.p_name);
      if (old && (old.sha256 !== body.p_sha256 || old.content !== body.p_content)) return error('ARTIFACT_CONFLICT');
      const artifact = old || { workspace_id: 'shared', name: body.p_name, content: body.p_content, sha256: body.p_sha256 };
      db.artifacts.set(body.p_name, artifact); return response({ name: artifact.name, sha256: artifact.sha256 });
    }
    throw new Error('UNEXPECTED_TEST_REST_ROUTE');
  };
  const options = () => ({ persistence: createCloudPersistence({ url: 'https://test-project.supabase.co', serviceRoleKey: 'test-server-key', fetcher }) });
  return { db, fetcher, options };
}

const data = result => JSON.parse(result.body);
async function taskCall(f, scenario, rest = {}) {
  const result = await executeApi('/api/tasks', 'POST', { title: `cloud ${scenario}`, scenario, idempotencyKey: `cloud-${scenario}-01`, ...rest }, f.options());
  assert.equal(result.status, 201);
  return data(result).task;
}

test('Read-only cloud snapshots never acquire writer or pause active tasks', async () => {
  const f = database(); f.db.state = blank(); f.db.state.tasks.push({ id: 'task_active', status: 'RUNNING', title: '현재 실행', workUnits: [], events: [] });
  f.db.lease_owner = randomUUID(); f.db.lease_until = Date.now() + 120000;
  const result = await executeApi('/api/state', 'GET', undefined, f.options());
  assert.equal(result.status, 200); assert.equal(data(result).tasks[0].status, 'RUNNING');
  assert.equal(f.db.version, 0);
  assert.ok(f.db.calls.every(call => call.method === 'GET'));
  assert.equal(data(result).environment.deploymentMode, 'private-beta');
  assert.equal(data(result).resources.find(row => row.provider === 'Ollama').status, 'DISCONNECTED');
});

test('Cloud Canary persists actual content and exact receipt SHA across new handlers', async () => {
  const f = database(); const task = await taskCall(f, 'safe');
  assert.equal(task.status, 'VERIFIED'); assert.equal(task.mode, 'REAL');
  assert.equal(task.selectedResource.provider, 'Node Cloud Sandbox'); assert.equal(task.selectedResource.executionLocation, 'Cloud');
  assert.equal(task.qa.status, 'PASS'); assert.equal(f.db.lease_owner, null);
  const artifactResult = await executeApi(`/api/artifacts/${task.artifactId}`, 'GET', undefined, f.options());
  assert.equal(artifactResult.status, 200); assert.match(artifactResult.body, /Cloud 샌드박스/); assert.match(artifactResult.body, /요청의 실제 업무나 외부 작업은 수행하지 않습니다/);
  const receiptResult = await executeApi(`/api/receipts/${task.receiptId}`, 'GET', undefined, f.options());
  const receipt = data(receiptResult).receipt;
  assert.equal(receipt.status, 'VERIFIED'); assert.equal(receipt.mode, 'REAL'); assert.equal(receipt.sha256, hash(artifactResult.body));
  assert.equal(receipt.externalActions, 0); assert.equal(f.db.artifacts.size, 1);
  const duplicate = await executeApi('/api/tasks', 'POST', { title: 'cloud safe', scenario: 'safe', idempotencyKey: 'cloud-safe-01' }, f.options());
  assert.equal(duplicate.status, 200); assert.equal(data(duplicate).reused, true); assert.equal(f.db.artifacts.size, 1);
});

test('Cloud approval, failure resume and MOCK failover retain safe contracts', async () => {
  const f = database(); const approval = await taskCall(f, 'approval', { title: 'Production에 배포' });
  assert.equal(approval.status, 'WAITING_APPROVAL'); assert.equal(f.db.artifacts.size, 0);
  const accepted = await executeApi(`/api/tasks/${approval.id}/approval`, 'POST', { decision: 'approve' }, f.options());
  assert.equal(data(accepted).task.status, 'VERIFIED'); assert.equal(data(accepted).task.approval.scope, 'SANDBOX_SIMULATION_ONLY');
  const failed = await taskCall(f, 'failure'); assert.equal(failed.status, 'FAILED');
  const units = failed.workUnits.map(row => row.id);
  const resumed = await executeApi(`/api/tasks/${failed.id}/resume`, 'POST', {}, f.options());
  assert.equal(data(resumed).task.status, 'VERIFIED'); assert.deepEqual(data(resumed).task.workUnits.map(row => row.id), units);
  assert.equal(data(resumed).task.workUnits[0].attempts, 2);
  const failover = await taskCall(f, 'failover'); assert.equal(failover.mode, 'MOCK'); assert.equal(failover.fallback.to, 'Mock Provider B');
  const summary = await taskCall(f, 'summary', { inputText: '시험 입력' });
  assert.equal(summary.status, 'SKIPPED'); assert.equal(summary.error, 'SKIPPED_LOCAL_AI_NOT_AVAILABLE');
});

test('Active lease rejects mutation, while read-only view remains available', async () => {
  const f = database(); f.db.lease_owner = randomUUID(); f.db.lease_until = Date.now() + 120000;
  const result = await executeApi('/api/tasks', 'POST', { title: 'writer 충돌', scenario: 'safe', idempotencyKey: 'cloud-busy-key' }, f.options());
  assert.equal(result.status, 409); assert.equal(data(result).error, 'LEASE_BUSY');
  assert.equal(f.db.version, 0); assert.equal(f.db.state, null);
  assert.equal((await executeApi('/api/state', 'GET', undefined, f.options())).status, 200);
});

test('Only expired different owner triggers PAUSED recovery and abandoned work keeps lease', async () => {
  const f = database(); f.db.state = blank();
  const oldTask = { id: 'task_old', title: '기존 일', status: 'RUNNING', currentStage: 'EXECUTION', mode: 'REAL', workUnits: [], events: [], checkpoint: { nextStage: 5, completedWorkUnits: ['old_done'] } };
  f.db.state.tasks.push(oldTask); f.db.lease_owner = randomUUID(); f.db.lease_until = Date.now() - 1;
  const store = f.options().persistence.store; await store.init();
  assert.equal(store.state.tasks[0].status, 'RUNNING');
  await store.mutate(() => {});
  assert.equal(store.state.tasks[0].status, 'PAUSED'); assert.deepEqual(store.state.tasks[0].checkpoint.completedWorkUnits, ['old_done']); await store.close();
  const fresh = f.options().persistence.store; await fresh.init();
  await fresh.mutate(state => { state.tasks[0].status = 'RUNNING'; });
  const owner = f.db.lease_owner; await fresh.close(); assert.equal(f.db.lease_owner, owner);
});

test('CAS conflict, immutable artifact and lease takeover block writes without overwriting', async () => {
  const f = database(); const persistence = f.options().persistence;
  await persistence.store.init(); await persistence.artifactStorage.init();
  try {
    await persistence.store.mutate(() => {});
    await persistence.artifactStorage.write('test-report.md', 'original REAL report');
    await assert.rejects(persistence.artifactStorage.write('test-report.md', 'changed REAL report'), /ARTIFACT_CONFLICT/);
    assert.equal(await persistence.artifactStorage.read('test-report.md'), 'original REAL report');
    f.db.conflictNextSave = true;
    await assert.rejects(persistence.store.mutate(state => { state.memory.push({ race: true }); }), /VERSION_CONFLICT/);
    assert.equal(f.db.state.memory.length, 0);
    f.db.version += 1;
    await assert.rejects(persistence.artifactStorage.write('other-report.md', 'REAL'), /LEASE_LOST/);
    f.db.lease_owner = randomUUID();
    await assert.rejects(persistence.store.mutate(state => { state.memory.push({ hacked: true }); }), /LEASE_BUSY/);
    assert.equal(f.db.state.memory.length, 0);
    await assert.rejects(persistence.artifactStorage.read('../.env'), /ARTIFACT_PATH_INVALID/);
  } finally { await persistence.artifactStorage.close(); await persistence.store.close(); }
});

test('Adapter blocks unsupported routes and redacts provider error bodies', async () => {
  assert.equal((await executeApi('/api/events')).status, 404);
  assert.equal((await executeApi('/api/../../.env')).status, 404);
  const rest = new SupabaseRest({ url: 'https://test-project.supabase.co', serviceRoleKey: 'do-not-expose', fetcher: async () => new Response(JSON.stringify({ message: 'unexpected do-not-expose details' }), { status: 500 }) });
  await assert.rejects(rest.request('/core_console_state_v2'), error => error.message === 'CLOUD_STORAGE_OPERATION_FAILED' && !error.message.includes('do-not-expose'));
  assert.throws(() => new SupabaseRest({ url: 'http://evil.invalid', serviceRoleKey: 'test' }), /CLOUD_STORAGE_URL_INVALID/);
  for (const [reported, mapped] of [['STATE_VERSION_CONFLICT', 'VERSION_CONFLICT'], ['ARTIFACT_HASH_MISMATCH', 'ARTIFACT_SHA_MISMATCH'], ['ARTIFACT_IMMUTABLE', 'ARTIFACT_CONFLICT']]) {
    const conflict = new SupabaseRest({ url: 'https://test-project.supabase.co', serviceRoleKey: 'test', fetcher: async () => new Response(JSON.stringify({ code: 'P0001', message: reported }), { status: 400 }) });
    await assert.rejects(conflict.request('/core_console_state_v2'), error => error.status === 409 && error.message === mapped);
  }
});

test('Worker lease loss returns conflict and never blindly redispatches queued task', async () => {
  const f = database(); f.db.takeoverWhenWorkerStarts = true;
  const result = await executeApi('/api/tasks', 'POST', { title: '중간 lease 상실', scenario: 'safe', idempotencyKey: 'lost-lease-worker-01' }, f.options());
  assert.equal(result.status, 409); assert.match(data(result).error, /LEASE_(BUSY|LOST)/);
  assert.equal(f.db.artifacts.size, 0);
  assert.ok(f.db.calls.filter(call => call.name === 'rpc/core_console_acquire_lease_v2').length < 6);
  assert.equal(f.db.state.tasks[0].status, 'QUEUED');
  assert.ok(f.db.lease_owner);
});
