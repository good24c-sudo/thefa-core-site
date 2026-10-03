import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createCoreServer } from '../server.mjs';

async function makeDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'thefa-core-console-'));
}

async function start(dataDir, options = {}) {
  const app = await createCoreServer({ dataDir, host: '127.0.0.1', ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return { ...app, base: `http://127.0.0.1:${address.port}` };
}

async function stop(app) {
  await new Promise(resolve => app.server.close(resolve));
}

async function login(app, email, accessCode = '') {
  const response = await fetch(`${app.base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, accessCode })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';', 1)[0];
}
async function jsonRequest(app, route, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${app.base}${route}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, body: await response.json().catch(() => ({})) };
}

test('public health and app shell are reachable', async t => {
  const dataDir = await makeDataDir();
  const app = await start(dataDir);
  t.after(async () => { await stop(app); await fs.rm(dataDir, { recursive: true, force: true }); });

  const health = await jsonRequest(app, '/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.storage, 'READY');
  assert.equal(health.body.connections.workUnitApi.state, 'CONNECTION_PENDING');

  const page = await fetch(`${app.base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /FOUNDER BETA/);
});

test('bootstrap requires a session', async t => {
  const dataDir = await makeDataDir();
  const app = await start(dataDir);
  t.after(async () => { await stop(app); await fs.rm(dataDir, { recursive: true, force: true }); });
  const result = await jsonRequest(app, '/api/bootstrap');
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, 'AUTH_REQUIRED');
});
test('task persists across restart and disconnected execution creates no fake records', async t => {
  const dataDir = await makeDataDir();
  let app = await start(dataDir);
  const cookie = await login(app, 'owner@example.test');
  let boot = await jsonRequest(app, '/api/bootstrap', { cookie });
  const workspaceId = boot.body.workspaces[0].id;

  const created = await jsonRequest(app, `/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST', cookie, body: { title: '실제 저장 작업', summary: '재접속 후에도 남아야 합니다.' }
  });
  assert.equal(created.response.status, 201);
  const taskId = created.body.task.id;

  const execute = await jsonRequest(app, `/api/workspaces/${workspaceId}/tasks/${taskId}/execute`, {
    method: 'POST', cookie, body: {}
  });
  assert.equal(execute.response.status, 503);
  assert.equal(execute.body.error, 'WORK_UNIT_CONNECTION_PENDING');
  assert.equal(execute.body.runCreated, false);
  assert.equal(execute.body.workUnitCreated, false);

  boot = await jsonRequest(app, '/api/bootstrap', { cookie });
  assert.equal(boot.body.records.tasks.length, 1);
  assert.equal(boot.body.records.runs.length, 0);
  assert.equal(boot.body.records.workUnits.length, 0);
  await stop(app);

  app = await start(dataDir);
  t.after(async () => { await stop(app); await fs.rm(dataDir, { recursive: true, force: true }); });
  const afterRestart = await jsonRequest(app, '/api/bootstrap', { cookie });
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.body.records.tasks[0].id, taskId);
});
test('workspace ownership prevents cross-user access', async t => {
  const dataDir = await makeDataDir();
  const app = await start(dataDir);
  t.after(async () => { await stop(app); await fs.rm(dataDir, { recursive: true, force: true }); });

  const ownerCookie = await login(app, 'owner@example.test');
  const ownerBoot = await jsonRequest(app, '/api/bootstrap', { cookie: ownerCookie });
  const ownerWorkspace = ownerBoot.body.workspaces[0].id;

  const otherCookie = await login(app, 'other@example.test');
  const blocked = await jsonRequest(app, `/api/workspaces/${ownerWorkspace}/tasks`, {
    method: 'POST', cookie: otherCookie, body: { title: '침범 시도', summary: '' }
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.error, 'WORKSPACE_FORBIDDEN');

  const ownerAfter = await jsonRequest(app, '/api/bootstrap', { cookie: ownerCookie });
  assert.equal(ownerAfter.body.records.tasks.length, 0);
});

test('non-local bind fails closed without preview access code', async t => {
  const dataDir = await makeDataDir();
  t.after(async () => fs.rm(dataDir, { recursive: true, force: true }));
  await assert.rejects(
    () => createCoreServer({ dataDir, host: '0.0.0.0', previewCode: '' }),
    /PREVIEW_CODE_REQUIRED_FOR_NON_LOCAL_HOST/
  );
});

test('configured preview access code is required and email allowlist is enforced', async t => {
  const dataDir = await makeDataDir();
  const app = await start(dataDir, { previewCode: 'beta-code', previewEmails: 'allowed@example.test' });
  t.after(async () => { await stop(app); await fs.rm(dataDir, { recursive: true, force: true }); });
  const wrongCode = await fetch(`${app.base}/api/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'allowed@example.test', accessCode: 'wrong' })
  });
  assert.equal(wrongCode.status, 401);

  const blockedEmail = await fetch(`${app.base}/api/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'other@example.test', accessCode: 'beta-code' })
  });
  assert.equal(blockedEmail.status, 403);

  const cookie = await login(app, 'allowed@example.test', 'beta-code');
  const boot = await jsonRequest(app, '/api/bootstrap', { cookie });
  assert.equal(boot.response.status, 200);
  assert.equal(boot.body.user.email, 'allowed@example.test');
});
