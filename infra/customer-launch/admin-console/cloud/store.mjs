import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const clone = value => structuredClone(value);
const sha = content => createHash('sha256').update(content).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const blankState = () => ({ version: 2, tasks: [], artifacts: [], receipts: [], memory: [], idempotency: {} });
const nameCheck = name => { if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,180}\.md$/.test(name)) throw fail(400, 'ARTIFACT_PATH_INVALID'); };

function validState(state) {
  if (state == null) return blankState();
  if (state.version !== 2 || !Array.isArray(state.tasks) || !Array.isArray(state.artifacts) || !Array.isArray(state.receipts) || !Array.isArray(state.memory) || typeof state.idempotency !== 'object' || !state.idempotency) throw fail(503, 'INVALID_CLOUD_STATE');
  return clone(state);
}
function versionOf(value) {
  const version = Number(value ?? 0);
  if (!Number.isSafeInteger(version) || version < 0) throw fail(503, 'INVALID_CLOUD_VERSION');
  return version;
}

export class SupabaseRest {
  #key;
  constructor({ url, serviceRoleKey, fetcher = fetch }) {
    if (typeof url !== 'string' || !url || typeof serviceRoleKey !== 'string' || !serviceRoleKey) throw fail(503, 'CLOUD_STORAGE_NOT_CONFIGURED');
    let parsed; try { parsed = new URL(url); } catch { throw fail(503, 'CLOUD_STORAGE_NOT_CONFIGURED'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !/^([a-z0-9-]+\.)?supabase\.co$/i.test(parsed.hostname)) throw fail(503, 'CLOUD_STORAGE_URL_INVALID');
    this.url = parsed.origin; this.#key = serviceRoleKey; this.fetcher = fetcher;
  }
  async request(route, method = 'GET', body) {
    if (!/^\/(core_console_state_v2|core_console_artifacts_v2|rpc\/core_console_(acquire_lease|save_state|release_lease|put_artifact)_v2)(?:\?|$)/.test(route)) throw fail(400, 'CLOUD_STORAGE_PATH_INVALID');
    let response;
    try {
      response = await this.fetcher(`${this.url}/rest/v1${route}`, { method, headers: { apikey: this.#key, authorization: `Bearer ${this.#key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'accept-profile': 'public', 'content-profile': 'public' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    } catch { throw fail(503, 'CLOUD_STORAGE_UNAVAILABLE'); }
    if (!response.ok) {
      let message = ''; try { const error = await response.json(); message = `${error.code || ''} ${error.message || ''}`; } catch {}
      const conflicts = { LEASE_BUSY: 'LEASE_BUSY', LEASE_LOST: 'LEASE_LOST', STATE_VERSION_CONFLICT: 'VERSION_CONFLICT', VERSION_CONFLICT: 'VERSION_CONFLICT', ARTIFACT_IMMUTABLE: 'ARTIFACT_CONFLICT', ARTIFACT_CONFLICT: 'ARTIFACT_CONFLICT', ARTIFACT_HASH_MISMATCH: 'ARTIFACT_SHA_MISMATCH', ARTIFACT_SHA_MISMATCH: 'ARTIFACT_SHA_MISMATCH' };
      for (const [reported, known] of Object.entries(conflicts)) if (message.includes(reported)) throw fail(409, known);
      throw fail(response.status === 409 ? 409 : 503, 'CLOUD_STORAGE_OPERATION_FAILED');
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw fail(503, 'CLOUD_STORAGE_INVALID_RESPONSE'); }
  }
  rpc(name, body) { return this.request(`/rpc/${name}`, 'POST', body); }
}

export class SupabaseStateStore {
  constructor(rest, { owner = randomUUID() } = {}) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) throw fail(400, 'INVALID_LEASE_OWNER');
    this.rest = rest; this.owner = owner; this.state = blankState(); this.version = 0; this.hasLease = false; this.closed = false; this.queue = Promise.resolve();
  }
  async init() {
    const rows = await this.rest.request('/core_console_state_v2?workspace_id=eq.shared&select=state,version,lease_owner,lease_until&limit=1');
    if (!Array.isArray(rows)) throw fail(503, 'INVALID_CLOUD_SNAPSHOT');
    this.state = validState(rows[0]?.state); this.version = versionOf(rows[0]?.version);
  }
  async acquire() {
    if (this.closed) throw fail(409, 'CLOUD_STORE_CLOSED');
    const result = await this.rest.rpc('core_console_acquire_lease_v2', { p_owner: this.owner, p_seconds: 120 });
    if (!result?.granted || result.lease_owner !== this.owner) throw fail(409, 'LEASE_BUSY');
    this.hasLease = true;
    return result;
  }
  async ensureLease() {
    if (!this.hasLease) throw fail(409, 'LEASE_REQUIRED');
    const result = await this.acquire();
    if (versionOf(result.version) !== this.version || result.recovered) throw fail(409, 'LEASE_LOST');
  }
  mutate(fn) {
    const operation = this.queue.then(async () => {
      const lease = await this.acquire();
      const draft = validState(lease.state); const version = versionOf(lease.version);
      if (lease.recovered) for (const task of draft.tasks) if (['RUNNING', 'QUEUED'].includes(task.status)) {
        task.status = 'PAUSED'; task.error = 'EXPIRED_CLOUD_WRITER_RECOVERY_READY'; task.updatedAt = new Date().toISOString();
        task.events.push({ id: `event_${randomUUID()}`, at: task.updatedAt, stage: task.currentStage, status: 'PAUSED', mode: task.mode, message: '만료된 Cloud writer의 체크포인트를 보존했습니다. 완료된 단계는 반복하지 않습니다.' });
      }
      const result = await fn(draft);
      const saved = await this.rest.rpc('core_console_save_state_v2', { p_owner: this.owner, p_expected_version: version, p_state: draft });
      this.version = versionOf(typeof saved === 'number' ? saved : saved?.version); this.state = draft; this.onChange?.();
      return clone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async close() {
    if (this.closed) return;
    await this.queue;
    // An interrupted worker keeps its lease so a later expired-owner takeover has evidence.
    if (this.hasLease && !this.state.tasks.some(task => ['RUNNING', 'QUEUED'].includes(task.status))) await this.rest.rpc('core_console_release_lease_v2', { p_owner: this.owner });
    this.closed = true;
  }
}

export class SupabaseArtifactStorage {
  constructor(rest, store) { this.rest = rest; this.store = store; }
  async init() { this.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'thefa-console-artifacts-')); }
  async read(name) {
    nameCheck(name);
    const rows = await this.rest.request(`/core_console_artifacts_v2?workspace_id=eq.shared&name=eq.${encodeURIComponent(name)}&select=name,content,sha256&limit=1`);
    if (!Array.isArray(rows)) throw fail(503, 'INVALID_CLOUD_ARTIFACT_RESPONSE');
    const record = rows[0];
    if (!record) throw Object.assign(new Error('ARTIFACT_NOT_FOUND'), { code: 'ENOENT', status: 404 });
    if (typeof record.content !== 'string' || sha(record.content) !== record.sha256) throw fail(409, 'ARTIFACT_INTEGRITY_FAILED');
    return record.content;
  }
  async write(name, content) {
    nameCheck(name);
    if (typeof content !== 'string' || Buffer.byteLength(content) > 64000) throw fail(400, 'ARTIFACT_CONTENT_INVALID');
    await this.store.ensureLease();
    if (!this.directory) throw fail(503, 'ARTIFACT_STORAGE_NOT_INITIALIZED');
    const file = path.join(this.directory, name); const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    const hash = sha(await fs.readFile(file));
    const stored = await this.rest.rpc('core_console_put_artifact_v2', { p_owner: this.store.owner, p_name: name, p_content: content, p_sha256: hash });
    if (stored?.sha256 !== hash || stored?.name !== name) throw fail(409, 'ARTIFACT_PERSISTENCE_MISMATCH');
  }
  async close() {
    if (!this.directory) return;
    const target = path.resolve(this.directory);
    if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep + 'thefa-console-artifacts-')) throw fail(500, 'TEMP_DIRECTORY_INVALID');
    await fs.rm(target, { recursive: true, force: true }); this.directory = null;
  }
}

export function createCloudPersistence(options = {}) {
  const rest = options.rest || new SupabaseRest({ url: options.url ?? process.env.SUPABASE_URL, serviceRoleKey: options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY, fetcher: options.fetcher });
  const store = new SupabaseStateStore(rest, { owner: options.owner });
  return { store, artifactStorage: new SupabaseArtifactStorage(rest, store) };
}
