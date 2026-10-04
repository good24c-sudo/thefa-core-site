import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoreIngressAdapter,
  createFounderLiveHttpTransport,
  createOpaqueActorRef,
  FOUNDER_LIVE_CONTRACT,
  FOUNDER_LIVE_DOWNSTREAM,
  FOUNDER_LIVE_EXECUTION_WORKSPACE
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
  assert.equal('scenario' in calls[0], false);
  assert.doesNotMatch(JSON.stringify(calls[0]), /founder@example\.test/);
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
