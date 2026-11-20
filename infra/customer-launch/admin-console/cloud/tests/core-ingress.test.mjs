import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoreIngressAdapter,
  createFounderLiveHttpTransport,
  createOpaqueActorRef,
  FOUNDER_LIVE_CONTRACT,
  FOUNDER_LIVE_DOWNSTREAM,
  FOUNDER_LIVE_EXECUTION_WORKSPACE,
  FOUNDER_LIVE_PIPELINE,
  normalizeCoreState
} from '../core-ingress-adapter.mjs';

const SHA = 'b2a909ede47324019a83fceb6ec277a6f47bac8c';
const actorRef = createOpaqueActorRef('founder@example.test');

test('server-only HTTP transport calls the staging ingress without serializing its credential', async () => {
  const calls = [];
  const credential = 'service-role-test-only-value';
  const transport = createFounderLiveHttpTransport({
    supabaseUrl: 'https://project-ref.supabase.co',
    serviceRoleKey: credential,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, init, body });
      const payload = body.action === 'READ_STATE'
        ? { tasks: [], environment: { enterpriseRouterConnected: true, executionPlane: 'CORE', transport: 'IMMUTABLE_GITHUB_INBOX' } }
        : body.action === 'READ_RECEIPT'
          ? { receipt: { id: '0123456789abcdef01234567', status: 'VERIFIED', terminal: true } }
          : { task: { id: '0123456789abcdef01234567', title: '실제 작업', status: 'QUEUED', receiptId: '0123456789abcdef01234567' }, reused: false };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const submitted = await transport.submit({
    contract: FOUNDER_LIVE_CONTRACT,
    actorRef,
    workspaceRef: FOUNDER_LIVE_EXECUTION_WORKSPACE,
    requestId: 'request-12345678',
    goal: '실제 작업',
    source: { channel: 'FOUNDER_CONSOLE', origin: 'https://app.thefacore.com', sha: SHA },
    downstreamCapabilities: [...FOUNDER_LIVE_DOWNSTREAM]
  });
  assert.equal(submitted.task.status, 'QUEUED');
  await transport.readState({ actorRef, workspaceRef: FOUNDER_LIVE_EXECUTION_WORKSPACE });
  await transport.readReceipt({ actorRef, workspaceRef: FOUNDER_LIVE_EXECUTION_WORKSPACE, receiptId: '0123456789abcdef01234567' });
  assert.deepEqual(calls.map(call => call.body.action), ['SUBMIT', 'READ_STATE', 'READ_RECEIPT']);
  assert.ok(calls.every(call => call.url === 'https://project-ref.supabase.co/functions/v1/thefa-founder-live-ingress-v1'));
  assert.ok(calls.every(call => call.init.headers.authorization === 'Bearer ' + credential));
  assert.ok(calls.every(call => call.init.headers.apikey === credential));
  assert.doesNotMatch(calls.map(call => call.init.body).join('\n'), new RegExp(credential));
  assert.equal(calls[0].body.workspace_ref, FOUNDER_LIVE_EXECUTION_WORKSPACE);
  assert.equal(calls[0].body.actor_ref, actorRef);
});

test('Core adapter fails closed when the real transport is absent', async () => {
  const adapter = createCoreIngressAdapter({ sourceSha: SHA });
  assert.equal(adapter.ready, false);
  const response = await adapter.executeApi('/api/tasks', 'POST', { title: '실제 작업', idempotencyKey: 'request-12345678' }, { actorRef });
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(response.body).code, 'CORE_INGRESS_UNAVAILABLE');
});

test('authenticated intent is reduced to an opaque, idempotent P02 Founder Live envelope', async () => {
  const calls = [];
  const transport = {
    async submit(value) {
      calls.push(value);
      return { task: { id: 'job_core_001', title: value.goal, status: 'QUEUED' }, reused: false };
    },
    async readState() { return { tasks: [] }; },
    async readReceipt() { return { receipt: { id: '0123456789abcdef01234567', terminal: true } }; }
  };
  const adapter = createCoreIngressAdapter({ transport, sourceSha: SHA });
  const response = await adapter.executeApi('/api/tasks', 'POST', {
    title: 'Founder Live 실제 Core 작업',
    scenario: 'safe',
    serviceTier: 'EXPERT',
    interactionKind: 'DIRECT_CHAT',
    ultraApproved: false,
    fileManifests: [],
    idempotencyKey: 'request-12345678'
  }, { actorRef, sourceOrigin: 'https://app.thefacore.com' });
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contract, FOUNDER_LIVE_CONTRACT);
  assert.deepEqual(calls[0].downstreamCapabilities, [...FOUNDER_LIVE_DOWNSTREAM]);
  assert.equal(calls[0].requestId, 'request-12345678');
  assert.equal(calls[0].goal, 'Founder Live 실제 Core 작업');
  assert.equal(calls[0].actorRef, actorRef);
  assert.equal(calls[0].workspaceRef, FOUNDER_LIVE_EXECUTION_WORKSPACE);
  assert.equal(calls[0].source.sha, SHA);
  assert.equal(calls[0].source.channel, 'FOUNDER_CONSOLE');
  assert.equal(calls[0].source.origin, 'https://app.thefacore.com');
  assert.equal(calls[0].serviceTier, 'EXPERT');
  assert.equal(calls[0].interactionKind, 'DIRECT_CHAT');
  assert.equal(calls[0].ultraApproved, false);
  assert.deepEqual(calls[0].fileManifests, []);
  assert.equal('scenario' in calls[0], false);
  assert.doesNotMatch(JSON.stringify(calls[0]), /founder@example\.test/);
});

test('conversation tier and file metadata are whitelisted and malformed manifests fail closed', async () => {
  const calls = [];
  const transport = {
    async submit(value) { calls.push(value); return { task: { id: '0123456789abcdef01234567', title: value.goal, status: 'QUEUED' }, reused: false }; },
    async readState() { return { tasks: [], resources: [] }; },
    async readReceipt() { return { receipt: { id: '0123456789abcdef01234567', terminal: true } }; }
  };
  const adapter = createCoreIngressAdapter({ transport, sourceSha: SHA });
  const sha256 = 'a'.repeat(64);
  const response = await adapter.executeApi('/api/tasks', 'POST', {
    title: '이 PPT를 분석해줘',
    serviceTier: 'EXPERT',
    interactionKind: 'FILE_ANALYSIS',
    ultraApproved: false,
    fileManifests: [{ file_ref: 'file_sha256:' + sha256, extension: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', byte_size: 1234, sha256 }],
    idempotencyKey: 'request-file-1234'
  }, { actorRef });
  assert.equal(response.status, 201);
  assert.equal(calls[0].serviceTier, 'EXPERT');
  assert.equal(calls[0].interactionKind, 'FILE_ANALYSIS');
  assert.equal(calls[0].fileManifests[0].extension, 'pptx');
  assert.equal('name' in calls[0].fileManifests[0], false);

  for (const body of [
    { title: 'x', serviceTier: 'VIP', idempotencyKey: 'request-bad-tier' },
    { title: 'x', interactionKind: 'UNKNOWN', idempotencyKey: 'request-bad-kind' },
    { title: 'x', ultraApproved: 'yes', idempotencyKey: 'request-bad-ultra' },
    { title: 'x', fileManifests: [{ file_ref: 'file_sha256:' + sha256, extension: 'pptx', mime: 'application/octet-stream', byte_size: 1, sha256: 'b'.repeat(64) }], idempotencyKey: 'request-bad-file' }
  ]) {
    const failed = await adapter.executeApi('/api/tasks', 'POST', body, { actorRef });
    assert.equal(failed.status, 400);
  }
});

test('state and terminal Receipt readback stay on the real Core transport', async () => {
  const calls = [];
  const transport = {
    async submit() { throw new Error('unexpected submit'); },
    async readState(context) { calls.push(['state', context]); return { tasks: [{ id: 'job_core_001', status: 'RUNNING' }] }; },
    async readReceipt(context) { calls.push(['receipt', context]); return { receipt: { id: context.receiptId, status: 'VERIFIED', terminal: true } }; }
  };
  const adapter = createCoreIngressAdapter({ transport, sourceSha: SHA });
  const state = await adapter.executeApi('/api/state', 'GET', undefined, { actorRef });
  const receipt = await adapter.executeApi('/api/receipts/0123456789abcdef01234567', 'GET', undefined, { actorRef });
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.body).tasks[0].id, 'job_core_001');
  assert.equal(receipt.status, 200);
  assert.equal(JSON.parse(receipt.body).receipt.terminal, true);
  assert.deepEqual(calls.map(call => call[0]), ['state', 'receipt']);
});

test('real Core state is normalized into the existing Founder Console UI contract', () => {
  const state = normalizeCoreState({
    tasks: [
      { id: '0123456789abcdef01234567', title: 'Founder Live staging task', status: 'RUNNING', receiptId: '0123456789abcdef01234567' },
      { id: '89abcdef0123456701234567', title: '완료 작업', status: 'VERIFIED', receiptId: '89abcdef0123456701234567' },
      { id: 'fedcba987654321001234567', title: '재조정 작업', status: 'RECONCILE_REQUIRED', receiptId: 'fedcba987654321001234567' }
    ],
    resourcesState: 'READY',
    resources: [
      { assetId: 'CLAUDE_CODE', type: 'SUBSCRIPTION', status: 'CURRENT', availability: 'AVAILABLE', provider: 'CLAUDE_CODE', executionLocation: 'EXTERNAL', lastCheck: 1791305726 },
      { assetId: 'CODEX', type: 'SUBSCRIPTION', status: 'EVIDENCE_GAP', availability: 'AUTH_UNVERIFIED', provider: 'CODEX', executionLocation: 'EXTERNAL', evidenceGaps: ['FRESH_AUTH_HEALTH_REQUIRED'] }
    ],
    environment: { currentHead: 'a'.repeat(40), decision: 'IN_PROGRESS' }
  });
  assert.deepEqual(state.pipeline, [...FOUNDER_LIVE_PIPELINE]);
  assert.equal(state.tasks[0].mode, 'REAL');
  assert.equal(state.tasks[0].currentStage, 'EXECUTION');
  assert.equal(state.tasks[0].selectedResource.provider, 'THE FA Core');
  assert.equal(state.tasks[1].currentStage, 'VERIFIED');
  assert.equal(state.tasks[1].qa.checks[0].passed, true);
  assert.equal(state.tasks[2].status, 'RECONCILE_REQUIRED');
  assert.equal(state.tasks[2].currentStage, 'QA');
  assert.equal(state.resources[0].status, 'CONNECTED');
  assert.equal(state.resources[0].sourceStatus, 'CURRENT');
  assert.match(state.resources[0].lastCheck, /^2026-/);
  assert.equal(state.resources[1].status, 'DISCONNECTED');
  assert.deepEqual(state.resources[1].evidenceGaps, ['FRESH_AUTH_HEALTH_REQUIRED']);
  assert.equal(state.usage.tasksCreated, 3);
  assert.equal(state.environment.appMode, 'FOUNDER_LIVE');
  assert.equal(state.environment.selectionAuthority, 'THE_FA_CORE');
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.artifacts, []);
  assert.deepEqual(state.memory, []);
});

test('Core state normalization fails closed on malformed task/resource containers', () => {
  assert.throws(() => normalizeCoreState({ tasks: {} }), /CORE_STATE_TASKS_INVALID/);
  assert.throws(() => normalizeCoreState({ tasks: [], resources: {} }), /CORE_STATE_RESOURCES_INVALID/);
  assert.throws(() => normalizeCoreState({ tasks: [{ status: 'RUNNING' }] }), /CORE_TASK_INVALID/);
  assert.throws(() => normalizeCoreState({ tasks: [], resources: [{ status: 'CURRENT' }] }), /CORE_RESOURCE_INVALID/);
});

test('Core submit response is immediately normalized for the live UI without Sandbox fields', async () => {
  const transport = {
    async submit(value) {
      return {
        task: { id: '0123456789abcdef01234567', title: value.goal, status: 'QUEUED', receiptId: '0123456789abcdef01234567' },
        reused: false
      };
    },
    async readState() { return { tasks: [], resources: [] }; },
    async readReceipt() { return { receipt: { id: '0123456789abcdef01234567', terminal: true } }; }
  };
  const adapter = createCoreIngressAdapter({ transport, sourceSha: SHA });
  const response = await adapter.executeApi('/api/tasks', 'POST', {
    title: 'APP 실사용 Alpha 연결',
    idempotencyKey: 'request-12345678'
  }, { actorRef, sourceOrigin: 'https://app.thefacore.com' });
  const body = JSON.parse(response.body);
  assert.equal(response.status, 201);
  assert.equal(body.task.mode, 'REAL');
  assert.equal(body.task.scenario, 'core');
  assert.equal(body.task.currentStage, 'RESOURCE_SELECTION');
  assert.equal(body.task.selectedResource.provider, 'THE FA Core');
});

test('Core transport errors never fall back to the Sandbox engine', async () => {
  const transport = {
    async submit() { throw Object.assign(new Error('transport down'), { status: 503 }); },
    async readState() { throw new Error('transport down'); },
    async readReceipt() { throw new Error('transport down'); }
  };
  const adapter = createCoreIngressAdapter({ transport, sourceSha: SHA });
  for (const [path, method, body] of [
    ['/api/state', 'GET', undefined],
    ['/api/tasks', 'POST', { title: '실제 작업', idempotencyKey: 'request-12345678' }],
    ['/api/receipts/0123456789abcdef01234567', 'GET', undefined]
  ]) {
    const response = await adapter.executeApi(path, method, body, { actorRef });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).code, 'CORE_INGRESS_UNAVAILABLE');
  }
});
