import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoreIngressAdapter,
  createOpaqueActorRef,
  FOUNDER_LIVE_CONTRACT,
  FOUNDER_LIVE_DOWNSTREAM
} from '../core-ingress-adapter.mjs';

const SHA = 'b2a909ede47324019a83fceb6ec277a6f47bac8c';
const actorRef = createOpaqueActorRef('founder@example.test');

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
    async readReceipt() { return { receipt: { id: 'receipt_core_001', terminal: true } }; }
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
  const receipt = await adapter.executeApi('/api/receipts/receipt_core_001', 'GET', undefined, { actorRef });
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
    ['/api/receipts/receipt_core_001', 'GET', undefined]
  ]) {
    const response = await adapter.executeApi(path, method, body, { actorRef });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).code, 'CORE_INGRESS_UNAVAILABLE');
  }
});
