import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(ROOT, 'public');
const DEFAULT_DATA_DIR = path.join(ROOT, 'runtime-data');
const COOKIE = 'thefa_core_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

function blankState() {
  return {
    schemaVersion: 1,
    users: {}, sessions: {}, workspaces: {}, tasks: {},
    runs: {}, workUnits: {}, approvals: {}, artifacts: {},
    qa: {}, receipts: {}
  };
}

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID()}`; }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const index = pair.indexOf('=');
    return index < 0 ? [pair, ''] : [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
  }));
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON_INVALID'), { status: 400 }); }
}

function json(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    ...headers
  });
  res.end(payload);
}

class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'store.json');
    this.state = blankState();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try { this.state = { ...blankState(), ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await this.persist(); }
    await this.cleanupSessions();
  }
  async persist() {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  async cleanupSessions() {
    const cutoff = Date.now();
    let changed = false;
    for (const [sid, session] of Object.entries(this.state.sessions)) {
      if (!session.expiresAt || Date.parse(session.expiresAt) <= cutoff) {
        delete this.state.sessions[sid];
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async mutate(fn) {
    const result = await fn(this.state);
    await this.persist();
    return result;
  }
}

function publicUser(user) { return { id: user.id, email: user.email, createdAt: user.createdAt }; }
function isLocalHost(host) { return ['127.0.0.1', 'localhost', '::1'].includes(host); }
function connectionState() {
  return {
    workUnitApi: {
      state: 'CONNECTION_PENDING',
      executable: false,
      message: '승인된 서버 실행 경로 연결 준비 중'
    }
  };
}

function recordList(state, bucket, workspaceId) {
  return Object.values(state[bucket]).filter(item => item.workspaceId === workspaceId);
}

function workspaceForUser(state, userId, workspaceId) {
  const workspace = state.workspaces[workspaceId];
  if (!workspace || workspace.ownerUserId !== userId) {
    throw Object.assign(new Error('WORKSPACE_FORBIDDEN'), { status: 403 });
  }
  return workspace;
}

function taskForUser(state, userId, workspaceId, taskId) {
  workspaceForUser(state, userId, workspaceId);
  const task = state.tasks[taskId];
  if (!task || task.workspaceId !== workspaceId) {
    throw Object.assign(new Error('TASK_NOT_FOUND'), { status: 404 });
  }
  return task;
}
async function login(store, email, accessCode, previewCode, allowlist) {
  email = normalizeEmail(email);
  if (!validEmail(email)) throw Object.assign(new Error('EMAIL_INVALID'), { status: 400 });
  if (previewCode && !secureEqual(accessCode, previewCode)) {
    throw Object.assign(new Error('ACCESS_CODE_INVALID'), { status: 401 });
  }
  if (allowlist.size && !allowlist.has(email)) {
    throw Object.assign(new Error('EMAIL_NOT_ALLOWED'), { status: 403 });
  }

  return store.mutate(state => {
    let user = Object.values(state.users).find(item => item.email === email);
    if (!user) {
      user = { id: id('usr'), email, createdAt: nowIso() };
      state.users[user.id] = user;
      const workspace = {
        id: id('ws'), ownerUserId: user.id, name: 'My Core Workspace',
        createdAt: nowIso(), updatedAt: nowIso()
      };
      state.workspaces[workspace.id] = workspace;
    }
    const sid = id('sid');
    state.sessions[sid] = {
      id: sid, userId: user.id, createdAt: nowIso(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    };
    return { sid, user };
  });
}
function requireUser(store, req) {
  const sid = parseCookies(req.headers.cookie || '')[COOKIE];
  const session = sid && store.state.sessions[sid];
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 });
  }
  const user = store.state.users[session.userId];
  if (!user) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 });
  return { sid, user };
}

function bootstrapFor(store, user) {
  const state = store.state;
  const workspaces = Object.values(state.workspaces).filter(item => item.ownerUserId === user.id);
  const workspaceIds = new Set(workspaces.map(item => item.id));
  const filter = bucket => Object.values(state[bucket]).filter(item => workspaceIds.has(item.workspaceId));
  return {
    user: publicUser(user),
    workspaces,
    records: {
      tasks: filter('tasks'), runs: filter('runs'), workUnits: filter('workUnits'),
      approvals: filter('approvals'), artifacts: filter('artifacts'),
      qa: filter('qa'), receipts: filter('receipts')
    },
    connections: connectionState(),
    authMode: 'LOCAL_PREVIEW_SESSION'
  };
}
function sameOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

async function serveStatic(res, pathname) {
  const targetName = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_ROOT, targetName);
  if (target !== PUBLIC_ROOT && !target.startsWith(PUBLIC_ROOT + path.sep)) return false;
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return false;
    const ext = path.extname(target).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon', '.png': 'image/png'
    };
    const body = await fs.readFile(target);
    res.writeHead(200, {
      'content-type': types[ext] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    res.end(body);
    return true;
  } catch { return false; }
}
export async function createCoreServer(options = {}) {
  const dataDir = options.dataDir || process.env.THEFA_CORE_DATA_DIR || DEFAULT_DATA_DIR;
  const host = options.host || process.env.THEFA_CORE_HOST || '127.0.0.1';
  const previewCode = options.previewCode ?? process.env.THEFA_CORE_PREVIEW_CODE ?? '';
  const allowlist = new Set(String(options.previewEmails ?? process.env.THEFA_CORE_PREVIEW_EMAILS ?? '')
    .split(',').map(normalizeEmail).filter(Boolean));
  if (!isLocalHost(host) && !previewCode) {
    throw new Error('PREVIEW_CODE_REQUIRED_FOR_NON_LOCAL_HOST');
  }
  const store = new JsonStore(dataDir);
  await store.init();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/') && !sameOriginAllowed(req)) {
        throw Object.assign(new Error('ORIGIN_FORBIDDEN'), { status: 403 });
      }
      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { ok: true, storage: 'READY', connections: connectionState() });
      }
      if (req.method === 'POST' && pathname === '/api/session') {
        const body = await readJson(req);
        const result = await login(store, body.email, body.accessCode, previewCode, allowlist);
        return json(res, 200, { user: publicUser(result.user), authMode: 'LOCAL_PREVIEW_SESSION' }, {
          'set-cookie': `${COOKIE}=${encodeURIComponent(result.sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
        });
      }
      if (req.method === 'DELETE' && pathname === '/api/session') {
        const { sid } = requireUser(store, req);
        await store.mutate(state => { delete state.sessions[sid]; });
        return json(res, 200, { ok: true }, {
          'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
        });
      }
      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        const { user } = requireUser(store, req);
        return json(res, 200, bootstrapFor(store, user));
      }

      const taskCollection = pathname.match(/^\/api\/workspaces\/([^/]+)\/tasks$/);
      if (req.method === 'POST' && taskCollection) {
        const { user } = requireUser(store, req);
        const workspaceId = taskCollection[1];
        workspaceForUser(store.state, user.id, workspaceId);
        const body = await readJson(req);
        const title = String(body.title || '').trim();
        const summary = String(body.summary || '').trim();
        if (!title || title.length > 120 || summary.length > 2000) {
          throw Object.assign(new Error('TASK_INPUT_INVALID'), { status: 400 });
        }
        const task = await store.mutate(state => {
          const item = {
            id: id('task'), workspaceId, ownerUserId: user.id,
            title, summary, status: 'DRAFT', createdAt: nowIso(), updatedAt: nowIso()
          };
          state.tasks[item.id] = item;
          state.workspaces[workspaceId].updatedAt = item.updatedAt;
          return item;
        });
        return json(res, 201, { task });
      }
      const taskItem = pathname.match(/^\/api\/workspaces\/([^/]+)\/tasks\/([^/]+)$/);
      if (req.method === 'PATCH' && taskItem) {
        const { user } = requireUser(store, req);
        const [, workspaceId, taskId] = taskItem;
        taskForUser(store.state, user.id, workspaceId, taskId);
        const body = await readJson(req);
        const allowedStatuses = new Set(['DRAFT', 'READY', 'ARCHIVED']);
        const task = await store.mutate(state => {
          const current = state.tasks[taskId];
          if (body.title !== undefined) {
            const value = String(body.title).trim();
            if (!value || value.length > 120) throw Object.assign(new Error('TASK_INPUT_INVALID'), { status: 400 });
            current.title = value;
          }
          if (body.summary !== undefined) {
            const value = String(body.summary).trim();
            if (value.length > 2000) throw Object.assign(new Error('TASK_INPUT_INVALID'), { status: 400 });
            current.summary = value;
          }
          if (body.status !== undefined) {
            const value = String(body.status).toUpperCase();
            if (!allowedStatuses.has(value)) throw Object.assign(new Error('TASK_STATUS_INVALID'), { status: 400 });
            current.status = value;
          }
          current.updatedAt = nowIso();
          return { ...current };
        });
        return json(res, 200, { task });
      }
      const executeTask = pathname.match(/^\/api\/workspaces\/([^/]+)\/tasks\/([^/]+)\/execute$/);
      if (req.method === 'POST' && executeTask) {
        const { user } = requireUser(store, req);
        const [, workspaceId, taskId] = executeTask;
        taskForUser(store.state, user.id, workspaceId, taskId);
        return json(res, 503, {
          error: 'WORK_UNIT_CONNECTION_PENDING',
          message: '승인된 서버 실행 경로 연결 준비 중입니다. 실행 요청은 생성되지 않았습니다.',
          runCreated: false,
          workUnitCreated: false,
          connection: connectionState().workUnitApi
        });
      }

      const approvalDecision = pathname.match(/^\/api\/workspaces\/([^/]+)\/approvals\/([^/]+)\/decision$/);
      if (req.method === 'POST' && approvalDecision) {
        const { user } = requireUser(store, req);
        const [, workspaceId, approvalId] = approvalDecision;
        workspaceForUser(store.state, user.id, workspaceId);
        const approval = store.state.approvals[approvalId];
        if (!approval || approval.workspaceId !== workspaceId) {
          throw Object.assign(new Error('APPROVAL_NOT_FOUND'), { status: 404 });
        }
        const body = await readJson(req);
        const decision = String(body.decision || '').toUpperCase();
        if (!['APPROVED', 'REJECTED'].includes(decision)) {
          throw Object.assign(new Error('APPROVAL_DECISION_INVALID'), { status: 400 });
        }
        const saved = await store.mutate(state => {
          state.approvals[approvalId] = { ...state.approvals[approvalId], decision, decidedAt: nowIso() };
          return { ...state.approvals[approvalId] };
        });
        return json(res, 200, { approval: saved });
      }
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (await serveStatic(res, pathname)) return;
        return json(res, 404, { error: 'NOT_FOUND' });
      }
      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const status = Number(error.status) || 500;
      const code = status >= 500 ? 'INTERNAL_ERROR' : String(error.message || 'REQUEST_FAILED');
      if (status >= 500) console.error(error);
      return json(res, status, { error: code });
    }
  });

  return { server, store, host };
}

async function main() {
  const port = Number(process.env.PORT || 4173);
  const app = await createCoreServer();
  app.server.listen(port, app.host, () => {
    console.log(`THEFA Core Founder Beta Preview: http://${app.host}:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
