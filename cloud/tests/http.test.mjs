import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createCloudHandler } from '../server.mjs';
import { createCoreIngressAdapter } from '../core-ingress-adapter.mjs';

const ORIGIN = 'https://thefa-core-console.vercel.app';
const APP_ORIGIN = 'https://app.thefacore.com';
const EMAIL = 'invited@example.test';
const COOKIE = '__Host-core_session=test-only-session';
const fail = (status, message) => Object.assign(new Error(message), { status });

async function fixture(t, overrides = {}) {
  const calls = { requests: [], verifications: [], sessions: [], logout: [], engine: [] };
  let active = true;
  const auth = {
    async requestCode(email) { calls.requests.push(email); return { accepted: true }; },
    async verifyCode(body) {
      calls.verifications.push(body);
      if (body.email !== EMAIL || body.code !== '123456') throw fail(400, 'INVALID_CODE');
      active = true;
      return { cookie: `${COOKIE}; Path=/; HttpOnly; Secure; SameSite=Strict`, token: 'must-not-leak', email: EMAIL };
    },
    async getSession(cookie) {
      calls.sessions.push(cookie);
      return active && cookie?.split(';').map(value => value.trim()).includes(COOKIE) ? { email: EMAIL } : null;
    },
    async logout(cookie) {
      calls.logout.push(cookie);
      active = false;
      return '__Host-core_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
    }
  };
  const engine = async (path, method, body) => {
    calls.engine.push({ path, method, body });
    if (path === '/api/state') return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ tasks: [], auth: { email: 'untrusted-engine-email@example.test' }, environment: { deploymentMode: 'untrusted', businessProductionConnected: true } })
    };
    if (path === '/api/artifacts/artifact-test') return { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="sandbox-report.md"' }, body: '# Cloud sandbox report\n' };
    if (path === '/api/tasks' && method === 'POST') return { status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: { id: 'task-test', title: body.title } }) };
    return { status: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"NOT_FOUND"}' };
  };
  const server = createServer(createCloudHandler({ origin: ORIGIN, auth, engine, ...overrides }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  const port = server.address().port;
  const call = ({ path = '/', method = 'GET', headers = {}, body, chunked = false } = {}) => new Promise((resolve, reject) => {
    const payload = typeof body === 'object' && body !== null ? JSON.stringify(body) : body;
    const requestHeaders = { host: new URL(ORIGIN).host, ...(!chunked && payload !== undefined ? { 'content-length': Buffer.byteLength(payload) } : {}), ...headers };
    const wireHeaders = Array.isArray(requestHeaders.host) ? Object.entries(requestHeaders).flatMap(([name, value]) => Array.isArray(value) ? value.flatMap(item => [name, item]) : [name, value]) : requestHeaders;
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: wireHeaders }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* Some tested routes are HTML or binary. */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error('HTTP_TEST_TIMEOUT')));
    req.on('error', reject);
    if (chunked && payload !== undefined) {
      for (let offset = 0; offset < payload.length; offset += 4096) req.write(payload.slice(offset, offset + 4096));
      req.end();
    } else req.end(payload);
  });
  return { calls, call, auth, engine };
}

const jsonHeaders = { origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const sessionHeaders = { ...jsonHeaders, cookie: COOKIE };

test('anonymous documents redirect to login; protected API, artifact and app assets deny access', async t => {
  const { call, calls } = await fixture(t);
  for (const path of ['/', '/index.html']) {
    const response = await call({ path });
    assert.equal(response.status, 303, path);
    assert.equal(response.headers.location, '/login.html');
    assert.equal(response.text, '');
  }
  for (const path of ['/api/state', '/api/artifacts/artifact-test', '/styles.css', '/app.js', '/downloads/THEFA-Local-Setup-Windows.zip']) {
    const response = await call({ path });
    assert.equal(response.status, 401, path);
    assert.doesNotMatch(response.text, /Cloud sandbox report|goal-form|const model/);
  }
  assert.equal(calls.engine.length, 0);
});

test('login and its allowlisted brand/font assets remain public with security headers', async t => {
  const { call } = await fixture(t);
  for (const path of ['/login.html', '/login.css', '/login.js', '/assets/THEFA_Core_Wordmark_Dark_web.svg', '/assets/THEFA_Core_Primary_Light_web.svg', '/assets/PretendardVariable-subset.woff2']) {
    const response = await call({ path });
    assert.equal(response.status, 200, path);
    assert.ok(response.text.length > 0, path);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
  }
  const login = await call({ path: '/login.html' });
  assert.doesNotMatch(login.headers['content-security-policy'], /unsafe-inline/);
  const head = await call({ path: '/login.js', method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
});

test('forged email, auth headers and cookie text cannot establish a session', async t => {
  const { call, calls } = await fixture(t);
  for (const headers of [
    { 'x-user-email': EMAIL },
    { authorization: `Bearer ${EMAIL}`, cookie: `email=${EMAIL}` },
    { cookie: '__Host-core_session=forged' },
    { cookie: `session=${EMAIL}; authenticated=true` }
  ]) assert.equal((await call({ path: '/api/state', headers })).status, 401);
  assert.equal(calls.engine.length, 0);
});

test('missing or foreign POST Origin rejects before authentication or engine dispatch', async t => {
  const { call, calls } = await fixture(t);
  for (const headers of [
    { 'content-type': 'application/json', cookie: COOKIE },
    { ...sessionHeaders, origin: 'https://attacker.example.test' },
    { ...sessionHeaders, 'sec-fetch-site': 'cross-site' },
    { ...sessionHeaders, 'sec-fetch-site': 'same-site' }
  ]) {
    for (const path of ['/auth/request-code', '/auth/verify-code', '/auth/logout', '/api/tasks']) {
      assert.equal((await call({ path, method: 'POST', headers, body: { email: EMAIL, code: '123456', title: 'test' } })).status, 403, path);
    }
  }
  assert.deepEqual(calls, { requests: [], verifications: [], sessions: [], logout: [], engine: [] });
});

test('JSON content type, malformed JSON and non-object request shape are rejected', async t => {
  const { call, calls } = await fixture(t);
  const unsupported = await call({ path: '/auth/request-code', method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{"email":"invited@example.test"}' });
  assert.equal(unsupported.status, 415);
  for (const body of ['{', 'null', '[]', '"text"', '123', 'true']) {
    const response = await call({ path: '/auth/request-code', method: 'POST', headers: jsonHeaders, body });
    assert.equal(response.status, 400, body);
  }
  assert.equal(calls.requests.length, 0);
});

test('16 KiB body boundary is enforced before mail or engine execution', async t => {
  const { call, calls } = await fixture(t);
  const prefix = '{"email":"invited@example.test","padding":"';
  const suffix = '"}';
  const boundary = prefix + 'x'.repeat(16384 - Buffer.byteLength(prefix + suffix)) + suffix;
  assert.equal(Buffer.byteLength(boundary), 16384);
  assert.equal((await call({ path: '/auth/request-code', method: 'POST', headers: jsonHeaders, body: boundary })).status, 200);
  const callsBefore = calls.requests.length;
  assert.equal((await call({ path: '/auth/request-code', method: 'POST', headers: jsonHeaders, body: boundary + ' ' })).status, 413);
  assert.equal((await call({ path: '/api/tasks', method: 'POST', headers: sessionHeaders, body: boundary + ' ' })).status, 413);
  assert.equal(calls.requests.length, callsBefore);
  assert.equal(calls.engine.length, 0);
});

test('chunked body cannot bypass the 16 KiB bound', async t => {
  const { call, calls } = await fixture(t);
  const response = await call({ path: '/auth/request-code', method: 'POST', headers: { ...jsonHeaders, 'transfer-encoding': 'chunked' }, body: JSON.stringify({ email: EMAIL, padding: 'x'.repeat(17000) }), chunked: true });
  assert.equal(response.status, 413);
  assert.equal(calls.requests.length, 0);
});

test('request-code and verify-code produce only a secure cookie, with no response token', async t => {
  const { call, calls } = await fixture(t);
  const requested = await call({ path: '/auth/request-code', method: 'POST', headers: jsonHeaders, body: { email: EMAIL } });
  assert.equal(requested.status, 200);
  assert.deepEqual(requested.json, { accepted: true });
  assert.equal(requested.headers['set-cookie'], undefined);
  const verified = await call({ path: '/auth/verify-code', method: 'POST', headers: jsonHeaders, body: { email: EMAIL, code: '123456' } });
  assert.equal(verified.status, 200);
  assert.deepEqual(verified.json, { verified: true });
  assert.match(verified.headers['set-cookie'][0], /HttpOnly/);
  assert.match(verified.headers['set-cookie'][0], /Secure/);
  assert.match(verified.headers['set-cookie'][0], /SameSite=Strict/);
  assert.doesNotMatch(verified.text, /must-not-leak|test-only-session|token/);
  assert.deepEqual(calls.requests, [EMAIL]);
  const wrong = await call({ path: '/auth/verify-code', method: 'POST', headers: jsonHeaders, body: { email: EMAIL, code: '000000' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.headers['set-cookie'], undefined);
});

test('authenticated state adds verified email and explicit Cloud sandbox boundaries', async t => {
  const { call, calls } = await fixture(t);
  const response = await call({ path: '/api/state', headers: { cookie: COOKIE } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json.auth, { email: EMAIL });
  assert.equal(response.json.environment.deploymentMode, 'private-beta');
  assert.equal(response.json.environment.executionLocation, 'Cloud');
  assert.equal(response.json.environment.transport, 'polling');
  assert.equal(response.json.environment.privateBetaStorageConnected, true);
  assert.equal(response.json.environment.businessProductionConnected, false);
  assert.deepEqual(calls.engine[0], { path: '/api/state', method: 'GET', body: undefined });
  const app = await call({ path: '/app.js', headers: { cookie: COOKIE } });
  assert.equal(app.status, 200);
  assert.match(app.text, /THEFA_Core_Primary_Light_web\.svg/);
  const artifact = await call({ path: '/api/artifacts/artifact-test', headers: { cookie: COOKIE } });
  assert.equal(artifact.status, 200);
  assert.match(artifact.headers['content-type'], /text\/markdown/);
  assert.match(artifact.headers['content-disposition'], /attachment/);
  assert.equal(artifact.text, '# Cloud sandbox report\n');
});

test('explicit Core mode sends authenticated API traffic only to the server-side Core ingress', async t => {
  const coreCalls = [];
  const sourceSha = 'b2a909ede47324019a83fceb6ec277a6f47bac8c';
  const transport = {
    async submit(value) { coreCalls.push(['submit', value]); return { task: { id: 'job_core_001', title: value.goal, status: 'QUEUED' }, reused: false }; },
    async readState(context) { coreCalls.push(['state', context]); return { tasks: [], environment: { enterpriseRouterConnected: true } }; },
    async readReceipt(context) { coreCalls.push(['receipt', context]); return { receipt: { id: context.receiptId, status: 'VERIFIED', terminal: true } }; }
  };
  const coreIngress = createCoreIngressAdapter({ transport, sourceSha });
  const { call, calls } = await fixture(t, { coreIngress, env: { CORE_CONSOLE_EXECUTION_MODE: 'core', CORE_SOURCE_SHA: sourceSha } });
  const state = await call({ path: '/api/state', headers: { cookie: COOKIE } });
  assert.equal(state.status, 200);
  assert.equal(state.json.environment.executionMode, 'core');
  assert.equal(state.json.environment.coreIngressConnected, true);
  assert.equal(state.json.environment.privateBetaStorageConnected, false);
  assert.equal(state.json.environment.enterpriseRouterConnected, true);
  const created = await call({ path: '/api/tasks', method: 'POST', headers: sessionHeaders, body: { title: 'Founder Live real Core', idempotencyKey: 'request-12345678' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.task.id, 'job_core_001');
  const receipt = await call({ path: '/api/receipts/0123456789abcdef01234567', headers: { cookie: COOKIE } });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.json.receipt.terminal, true);
  assert.equal(calls.engine.length, 0);
  assert.deepEqual(coreCalls.map(call => call[0]), ['state', 'submit', 'receipt']);
  assert.match(coreCalls[0][1].actorRef, /^actor_sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(coreCalls), new RegExp(EMAIL.replace('.', '\\.')));
});

test('Core mode auto-wires the existing Supabase server credential to the Founder Live staging ingress', async t => {
  const sourceSha = '392a4a5526b41152890c32aa8e53958a036c3170';
  const serviceRole = 'service-role-test-only-value';
  const ingressCalls = [];
  const coreFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    ingressCalls.push({ url, init, body });
    const payload = body.action === 'READ_STATE'
      ? { tasks: [], environment: { enterpriseRouterConnected: true, executionPlane: 'CORE', transport: 'IMMUTABLE_GITHUB_INBOX' } }
      : body.action === 'READ_RECEIPT'
        ? { receipt: { id: body.receipt_id, status: 'VERIFIED', terminal: true } }
        : { task: { id: '0123456789abcdef01234567', title: body.goal, status: 'QUEUED', receiptId: '0123456789abcdef01234567' }, reused: false };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { call, calls } = await fixture(t, {
    coreFetch,
    env: {
      CORE_CONSOLE_EXECUTION_MODE: 'core',
      CORE_SOURCE_SHA: sourceSha,
      SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: serviceRole
    }
  });
  const state = await call({ path: '/api/state', headers: { cookie: COOKIE } });
  assert.equal(state.status, 200);
  assert.equal(state.json.environment.executionMode, 'core');
  assert.equal(state.json.environment.executionPlane, 'CORE');
  assert.equal(state.json.environment.transport, 'IMMUTABLE_GITHUB_INBOX');
  const created = await call({ path: '/api/tasks', method: 'POST', headers: sessionHeaders, body: { title: 'Founder Live 실제 Core', idempotencyKey: 'request-12345678' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.task.id, '0123456789abcdef01234567');
  const receipt = await call({ path: '/api/receipts/0123456789abcdef01234567', headers: { cookie: COOKIE } });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.json.receipt.terminal, true);
  assert.deepEqual(ingressCalls.map(call => call.body.action), ['READ_STATE', 'SUBMIT', 'READ_RECEIPT']);
  assert.ok(ingressCalls.every(call => call.url === 'https://project-ref.supabase.co/functions/v1/thefa-founder-live-ingress-v1'));
  assert.ok(ingressCalls.every(call => call.init.headers.authorization === 'Bearer ' + serviceRole));
  assert.ok(ingressCalls.every(call => !call.init.body.includes(serviceRole)));
  assert.equal(calls.engine.length, 0);
});

test('Core mode fails closed and never falls back to the Cloud Sandbox engine', async t => {
  const sourceSha = 'b2a909ede47324019a83fceb6ec277a6f47bac8c';
  const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_EXECUTION_MODE: 'core', CORE_SOURCE_SHA: sourceSha } });
  const state = await call({ path: '/api/state', headers: { cookie: COOKIE } });
  assert.equal(state.status, 503);
  assert.equal(state.json.code, 'CORE_INGRESS_UNAVAILABLE');
  const created = await call({ path: '/api/tasks', method: 'POST', headers: sessionHeaders, body: { title: 'must not fall back', idempotencyKey: 'request-12345678' } });
  assert.equal(created.status, 503);
  assert.equal(created.json.code, 'CORE_INGRESS_UNAVAILABLE');
  assert.equal(calls.engine.length, 0);
});
test('logout expires the secure cookie and prevents the former session from reading state', async t => {
  const { call, calls } = await fixture(t);
  const response = await call({ path: '/auth/logout', method: 'POST', headers: sessionHeaders, body: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { loggedOut: true });
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.equal((await call({ path: '/api/state', headers: { cookie: COOKIE } })).status, 401);
  assert.deepEqual(calls.logout, [COOKIE]);
  assert.equal(calls.engine.length, 0);
});

test('route query respects authentication and refuses ambiguous or traversal routes', async t => {
  const { call, calls } = await fixture(t);
  assert.equal((await call({ path: '/api/console?route=%2Fapi%2Fstate' })).status, 401);
  assert.equal((await call({ path: '/login.html?route=%2Fapp.js' })).status, 401);
  assert.equal(calls.engine.length, 0);
  assert.equal((await call({ path: '/api/console?route=%2Fapi%2Fstate', headers: { cookie: COOKIE } })).status, 200);
  for (const path of [
    '/api/console?route=%2Flogin.html&route=%2Fapi%2Fstate',
    '/api/console?route=%2F..%2Fcloud%2Fauth.mjs',
    '/api/console?route=%2F%252e%252e%2Fcloud%2Fauth.mjs',
    '/api/console?route=%2Fapi%2Fstate%3Femail%3Dforged',
    '/api/console?route=%2Fapi%2Fstate%23fragment',
    '/api/console?route=cloud%2Fauth.mjs',
    '/cloud/auth.mjs',
    '/.env'
  ]) assert.equal((await call({ path, headers: { cookie: COOKIE } })).status, 404, path);
});

test('incomplete configuration fails closed while login remains public', async t => {
  const { call, calls } = await fixture(t, { auth: undefined, env: {} });
  assert.equal((await call({ path: '/login.html' })).status, 200);
  for (const path of ['/', '/app.js', '/api/state']) assert.equal((await call({ path, headers: { cookie: COOKIE } })).status, 503, path);
  assert.equal((await call({ path: '/auth/request-code', method: 'POST', headers: jsonHeaders, body: { email: EMAIL } })).status, 503);
  assert.equal(calls.engine.length, 0);
});

test('Both exact HTTPS hosts support OTP login, session reads, tasks and logout', async t => {
  for (const origin of [ORIGIN, APP_ORIGIN]) {
    const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_ORIGINS: JSON.stringify([ORIGIN, APP_ORIGIN]) } });
    const host = new URL(origin).host;
    const forwarded = `for=192.0.2.1;host=${host};proto=https`;
    const browser = { ...jsonHeaders, host, origin, forwarded, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' };
    assert.equal((await call({ path: '/login.html', headers: { host, forwarded } })).status, 200);
    assert.equal((await call({ path: '/api/state', headers: { host, forwarded } })).status, 401);
    assert.equal((await call({ path: '/auth/request-code', method: 'POST', headers: browser, body: { email: EMAIL } })).status, 200);
    const verified = await call({ path: '/auth/verify-code', method: 'POST', headers: browser, body: { email: EMAIL, code: '123456' } });
    assert.equal(verified.status, 200);
    const cookie = verified.headers['set-cookie'][0];
    assert.match(cookie, /^__Host-core_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /(?:^|;)\s*Domain=/i);
    const authenticated = { ...browser, cookie: cookie.split(';')[0] };
    assert.equal((await call({ path: '/api/state', headers: authenticated })).status, 200);
    assert.equal((await call({ path: '/api/tasks', method: 'POST', headers: authenticated, body: { title: 'Cloud 샌드박스 시험' } })).status, 201);
    assert.equal((await call({ path: '/auth/logout', method: 'POST', headers: authenticated, body: {} })).status, 200);
    assert.equal((await call({ path: '/api/state', headers: authenticated })).status, 401);
    assert.equal(calls.requests.length, 1); assert.equal(calls.verifications.length, 1); assert.equal(calls.engine.filter(call => call.path === '/api/tasks').length, 1); assert.equal(calls.logout.length, 1);
  }
});

test('Adding a custom host keeps the old cookie valid and rejects crossed Host/Origin', async t => {
  const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_ORIGINS: JSON.stringify([APP_ORIGIN]) } });
  assert.equal((await call({ path: '/api/state', headers: sessionHeaders })).status, 200);
  const initialCalls = calls.sessions.length;
  for (const [host, origin] of [[new URL(ORIGIN).host, APP_ORIGIN], [new URL(APP_ORIGIN).host, ORIGIN]]) {
    for (const path of ['/auth/request-code', '/auth/verify-code', '/auth/logout', '/api/tasks']) {
      const result = await call({ path, method: 'POST', headers: { ...sessionHeaders, host, origin }, body: { email: EMAIL, code: '123456', title: 'crossed request' } });
      assert.equal(result.status, 403, `${host} ${origin} ${path}`);
    }
    assert.equal((await call({ path: '/api/state', headers: { host, origin, cookie: COOKIE } })).status, 403);
  }
  assert.equal(calls.sessions.length, initialCalls); assert.equal(calls.requests.length, 0); assert.equal(calls.verifications.length, 0); assert.equal(calls.logout.length, 0);
});

test('Forwarded metadata cannot override Host or Origin authority', async t => {
  const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_ORIGINS: JSON.stringify([APP_ORIGIN]) } });
  for (const origin of [ORIGIN, APP_ORIGIN]) {
    const host = new URL(origin).host;
    for (const forwarded of [`for=192.0.2.1;host=${host};proto=https`, 'for=192.0.2.1;host=attacker.example.test;proto=http']) {
      const headers = { ...sessionHeaders, host, origin, forwarded };
      assert.equal((await call({ path: '/login.html', headers })).status, 200);
      assert.equal((await call({ path: '/api/state', headers })).status, 200);
      assert.equal((await call({ path: '/api/tasks', method: 'POST', headers, body: { title: 'Forwarded metadata test' } })).status, 201);
    }
  }
  const before = Object.fromEntries(Object.entries(calls).map(([name, values]) => [name, values.length]));
  const forwarded = `for=192.0.2.1;host=${new URL(ORIGIN).host};proto=https`;
  for (const injected of [{ host: 'attacker.example.test' }, { origin: 'https://attacker.example.test' }, { origin: APP_ORIGIN }]) {
    const headers = { ...sessionHeaders, forwarded, ...injected };
    assert.equal((await call({ path: '/api/state', headers })).status, 403);
    for (const path of ['/auth/request-code', '/auth/verify-code', '/auth/logout', '/api/tasks']) {
      assert.equal((await call({ path, method: 'POST', headers, body: { email: EMAIL, code: '123456', title: 'untrusted request' } })).status, 403);
    }
  }
  assert.deepEqual(Object.fromEntries(Object.entries(calls).map(([name, values]) => [name, values.length])), before);
});

test('Unlisted hosts, explicit ports and x-forwarded header manipulation fail before auth', async t => {
  const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_ORIGINS: JSON.stringify([APP_ORIGIN]) } });
  const appHost = new URL(APP_ORIGIN).host;
  const headers = { ...sessionHeaders, host: appHost, origin: APP_ORIGIN };
  const invalidHeaders = [
    { host: 'attacker.example.test' }, { host: 'other.thefacore.com' }, { host: 'app.thefacore.com.attacker.test' },
    { host: 'app.thefacore.com:443' }, { host: 'app.thefacore.com:8443' }, { host: 'app.thefacore.com.' },
    { host: [appHost, new URL(ORIGIN).host] },
    { 'x-forwarded-host': new URL(ORIGIN).host }, { 'x-forwarded-host': `${appHost}, attacker.example.test` },
    { 'x-forwarded-proto': 'http' }, { 'x-forwarded-proto': 'https,http' }, { 'x-forwarded-port': '8443' }
  ];
  for (const injected of invalidHeaders) {
    assert.equal((await call({ path: '/auth/request-code', method: 'POST', headers: { ...headers, ...injected }, body: { email: EMAIL } })).status, 403, JSON.stringify(injected));
    assert.equal((await call({ path: '/api/state', headers: { ...headers, ...injected } })).status, 403, JSON.stringify(injected));
  }
  assert.deepEqual(calls, { requests: [], verifications: [], sessions: [], logout: [], engine: [] });
});

test('Both allowed hosts refuse same-site and cross-site mutation requests', async t => {
  const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_ORIGINS: JSON.stringify([APP_ORIGIN]) } });
  for (const origin of [ORIGIN, APP_ORIGIN]) for (const site of ['same-site', 'cross-site']) {
    const headers = { ...sessionHeaders, host: new URL(origin).host, origin, 'sec-fetch-site': site };
    for (const path of ['/auth/request-code', '/auth/verify-code', '/auth/logout', '/api/tasks']) assert.equal((await call({ path, method: 'POST', headers, body: { email: EMAIL, code: '123456', title: 'untrusted site' } })).status, 403);
  }
  assert.deepEqual(calls, { requests: [], verifications: [], sessions: [], logout: [], engine: [] });
});

test('Origin configuration rejects malformed, wildcard, non-HTTPS and noncanonical values', async t => {
  for (const config of ['not-json', '{}', '[null]', '["http://app.thefacore.com"]', '["https://*.thefacore.com"]', '["https://app.thefacore.com/"]', '["https://app.thefacore.com:443"]', '["https://user:pass@app.thefacore.com"]', '["https://app.thefacore.com/path"]']) {
    const { call, calls } = await fixture(t, { env: { CORE_CONSOLE_ORIGINS: config } });
    assert.equal((await call({ path: '/login.html' })).status, 200);
    assert.equal((await call({ path: '/api/state', headers: sessionHeaders })).status, 503, config);
    assert.equal((await call({ path: '/auth/request-code', method: 'POST', headers: jsonHeaders, body: { email: EMAIL } })).status, 503, config);
    assert.equal(calls.requests.length, 0); assert.equal(calls.engine.length, 0);
  }
});

test('setup package download requires an invited session and never invokes execution engine', async t => {
 const {call,calls}=await fixture(t,{read:async file=>{assert.equal(file,'lab/public/downloads/THEFA-Local-Setup-Windows.zip');return Buffer.from('PK-test-package');}});
 const response=await call({path:'/downloads/THEFA-Local-Setup-Windows.zip',headers:sessionHeaders});
 assert.equal(response.status,200);assert.equal(response.headers['content-type'],'application/zip');assert.equal(response.text,'PK-test-package');assert.equal(calls.engine.length,0);
});

