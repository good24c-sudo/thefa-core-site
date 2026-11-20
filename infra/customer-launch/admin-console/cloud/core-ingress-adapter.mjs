import { createHash } from 'node:crypto';

export const FOUNDER_LIVE_CONTRACT = 'founder_live_ingress_contract_v1';
export const FOUNDER_LIVE_DOWNSTREAM = Object.freeze([
  'THE_FA_MOBILE_DEVELOPMENT_ENTRY_V1',
  'THE_FA_WORK_UNIT_API_V2'
]);
export const FOUNDER_LIVE_EXECUTION_WORKSPACE = 'P02:19_v1:THE_FA_CORE_V2';

const jsonResponse = (status, payload) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(payload)
});

const unavailable = () => jsonResponse(503, {
  error: '실제 THE FA Core 연결을 사용할 수 없습니다.',
  code: 'CORE_INGRESS_UNAVAILABLE'
});

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const receiptIdPattern = /^[0-9a-f]{24}$/;
const shaPattern = /^[0-9a-f]{40}$/;
const fileShaPattern = /^[0-9a-f]{64}$/;
const serviceTiers = new Set(['AUTO', 'STANDARD', 'EXPERT', 'ULTRA', 'LOCAL_ONLY']);
const interactionKinds = new Set(['DIRECT_CHAT', 'FILE_ANALYSIS', 'RESEARCH', 'EXECUTION_TASK']);
const mimePattern = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function normalizeFileManifests(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw Object.assign(new Error('CORE_FILE_MANIFEST_INVALID'), { status: 400 });
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Object.assign(new Error('CORE_FILE_MANIFEST_INVALID'), { status: 400 });
    const sha256 = String(item.sha256 || '').toLowerCase();
    const fileRef = String(item.file_ref || '');
    const extension = String(item.extension || '').toLowerCase();
    const mime = String(item.mime || '');
    const byteSize = item.byte_size;
    if (!fileShaPattern.test(sha256) || fileRef !== 'file_sha256:' + sha256 || seen.has(fileRef)
        || !/^[a-z0-9]{0,16}$/.test(extension) || !mimePattern.test(mime)
        || !Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw Object.assign(new Error('CORE_FILE_MANIFEST_INVALID'), { status: 400 });
    }
    seen.add(fileRef);
    return { file_ref: fileRef, extension, mime, byte_size: byteSize, sha256 };
  });
}

function ingressEndpoint(supabaseUrl) {
  const parsed = new URL(String(supabaseUrl || ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname || !['', '/'].includes(parsed.pathname)) {
    throw new TypeError('CORE_SUPABASE_URL_INVALID');
  }
  return parsed.origin + '/functions/v1/thefa-founder-live-ingress-v1';
}

export function createFounderLiveHttpTransport({ supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = ingressEndpoint(supabaseUrl);
  const credential = String(serviceRoleKey || '').trim();
  if (!credential || typeof fetchImpl !== 'function') throw new TypeError('CORE_SERVER_TRANSPORT_CONFIG_REQUIRED');

  async function call(action, payload = {}) {
    const body = { action, ...payload };
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + credential,
        apikey: credential,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(body)
    });
    let parsed;
    try { parsed = await response.json(); }
    catch { throw Object.assign(new Error('CORE_INGRESS_RESPONSE_INVALID'), { status: 502 }); }
    if (!response.ok) {
      const message = typeof parsed?.error === 'string' ? parsed.error : typeof parsed?.code === 'string' ? parsed.code : 'CORE_INGRESS_REQUEST_FAILED';
      throw Object.assign(new Error(message.slice(0, 160)), { status: response.status >= 400 && response.status < 600 ? response.status : 503 });
    }
    return safeObject(parsed, 'CORE_INGRESS_RESPONSE_INVALID');
  }

  return Object.freeze({
    async submit(value) {
      return call('SUBMIT', {
        contract: value.contract,
        actor_ref: value.actorRef,
        workspace_ref: value.workspaceRef,
        request_id: value.requestId,
        goal: value.goal,
        source: value.source,
        downstream_capabilities: value.downstreamCapabilities,
        ...(value.interactionKind === undefined ? {} : { interaction_kind: value.interactionKind }),
        ...(value.serviceTier === undefined ? {} : { service_tier: value.serviceTier }),
        ...(value.ultraApproved === undefined ? {} : { ultra_approved: value.ultraApproved }),
        ...(value.fileManifests === undefined ? {} : { file_manifests: value.fileManifests })
      });
    },
    async readState(context) {
      return call('READ_STATE', { actor_ref: context.actorRef, workspace_ref: context.workspaceRef });
    },
    async readReceipt(context) {
      return call('READ_RECEIPT', {
        actor_ref: context.actorRef,
        workspace_ref: context.workspaceRef,
        receipt_id: context.receiptId
      });
    }
  });
}

export function createOpaqueActorRef(identity) {
  const value = String(identity || '').trim().toLowerCase();
  if (!value) throw new TypeError('ACTOR_IDENTITY_REQUIRED');
  return `actor_sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function validTransport(transport) {
  return Boolean(
    transport &&
    typeof transport.submit === 'function' &&
    typeof transport.readState === 'function' &&
    typeof transport.readReceipt === 'function'
  );
}

function safeObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(code), { status: 502 });
  }
  return value;
}

export const FOUNDER_LIVE_PIPELINE = Object.freeze([
  'REQUEST', 'GOAL', 'PLAN', 'WORK_UNITS', 'RESOURCE_SELECTION',
  'EXECUTION', 'REVIEW', 'QA', 'ARTIFACT', 'RECEIPT', 'VERIFIED'
]);

const coreStageByStatus = Object.freeze({
  QUEUED: 'RESOURCE_SELECTION',
  RUNNING: 'EXECUTION',
  VERIFIED: 'VERIFIED',
  FAILED: 'QA',
  RECONCILE_REQUIRED: 'QA',
  BLOCKED: 'RESOURCE_SELECTION'
});

function normalizeLastCheck(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

export function normalizeCoreTask(value) {
  const task = safeObject(value, 'CORE_TASK_INVALID');
  const id = typeof task.id === 'string' && task.id ? task.id : null;
  if (!id) throw Object.assign(new Error('CORE_TASK_INVALID'), { status: 502 });
  const coreStatus = typeof task.status === 'string' ? task.status : 'RECONCILE_REQUIRED';
  return {
    ...task,
    id,
    title: typeof task.title === 'string' && task.title.trim()
      ? task.title : 'THE FA Core 작업 ' + id.slice(0, 8),
    scenario: 'core',
    mode: 'REAL',
    status: coreStatus,
    currentStage: coreStageByStatus[coreStatus] || 'REQUEST',
    selectedResource: task.selectedResource && typeof task.selectedResource === 'object'
      ? task.selectedResource
      : { provider: 'THE FA Core', executionLocation: 'Core', status: 'CONNECTED' },
    events: Array.isArray(task.events) ? task.events : [],
    workUnits: Array.isArray(task.workUnits) ? task.workUnits : [],
    checkpoint: task.checkpoint ?? null,
    qa: task.qa ?? (coreStatus === 'VERIFIED'
      ? { result: 'PASS', checks: [{ name: 'CORE_TERMINAL_QA', passed: true, source: 'CORE_READBACK' }] }
      : null),
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null
  };
}

export function normalizeCoreResource(value) {
  const resource = safeObject(value, 'CORE_RESOURCE_INVALID');
  const assetId = typeof resource.assetId === 'string' && resource.assetId ? resource.assetId : null;
  if (!assetId) throw Object.assign(new Error('CORE_RESOURCE_INVALID'), { status: 502 });
  const sourceStatus = typeof resource.status === 'string' ? resource.status : 'EVIDENCE_GAP';
  const availability = typeof resource.availability === 'string' ? resource.availability : 'UNVERIFIED';
  const connected = sourceStatus === 'CURRENT' && availability === 'AVAILABLE';
  return {
    ...resource,
    assetId,
    provider: resource.provider || assetId,
    type: resource.type || 'RESOURCE',
    status: connected ? 'CONNECTED' : sourceStatus === 'PLANNED' ? 'PLANNED' : 'DISCONNECTED',
    sourceStatus,
    availability,
    executionLocation: resource.executionLocation || 'UNKNOWN',
    lastCheck: normalizeLastCheck(resource.lastCheck)
  };
}

export function normalizeCoreState(value) {
  const state = safeObject(value, 'CORE_STATE_INVALID');
  if (!Array.isArray(state.tasks)) {
    throw Object.assign(new Error('CORE_STATE_TASKS_INVALID'), { status: 502 });
  }
  if (state.resources !== undefined && !Array.isArray(state.resources)) {
    throw Object.assign(new Error('CORE_STATE_RESOURCES_INVALID'), { status: 502 });
  }
  const tasks = state.tasks.map(normalizeCoreTask);
  const resources = (state.resources || []).map(normalizeCoreResource);
  const environment = state.environment && typeof state.environment === 'object' && !Array.isArray(state.environment)
    ? state.environment : {};
  const usage = state.usage && typeof state.usage === 'object' && !Array.isArray(state.usage)
    ? state.usage : {};
  return {
    ...state,
    tasks,
    resources,
    approvals: Array.isArray(state.approvals) ? state.approvals : [],
    artifacts: Array.isArray(state.artifacts) ? state.artifacts : [],
    receipts: Array.isArray(state.receipts) ? state.receipts : [],
    memory: Array.isArray(state.memory) ? state.memory : [],
    usage: { tasksCreated: tasks.length, ...usage },
    pipeline: Array.isArray(state.pipeline) && state.pipeline.length
      ? state.pipeline : [...FOUNDER_LIVE_PIPELINE],
    environment: {
      appMode: 'FOUNDER_LIVE',
      dataMode: 'CORE_READBACK',
      providerMode: 'CORE_ROUTED',
      selectionAuthority: 'THE_FA_CORE',
      ...environment
    }
  };
}

export function createCoreIngressAdapter({
  transport,
  sourceSha,
  sourceChannel = 'FOUNDER_CONSOLE',
  workspaceRef = FOUNDER_LIVE_EXECUTION_WORKSPACE
} = {}) {
  const ready = validTransport(transport) && shaPattern.test(String(sourceSha || ''));

  async function executeApi(apiPath, method = 'GET', body, context = {}) {
    if (!ready) return unavailable();
    const actorRef = String(context.actorRef || '');
    if (!/^actor_sha256:[0-9a-f]{64}$/.test(actorRef)) {
      return jsonResponse(500, { error: 'Core 요청 주체를 확인할 수 없습니다.', code: 'CORE_ACTOR_BINDING_REQUIRED' });
    }
    try {
      if (apiPath === '/api/state' && method === 'GET') {
        const state = normalizeCoreState(await transport.readState({ actorRef, workspaceRef }));
        return jsonResponse(200, state);
      }
      if (apiPath === '/api/tasks' && method === 'POST') {
        const title = typeof body?.title === 'string' ? body.title.trim() : '';
        const requestId = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        if (!title || title.length > 4000) return jsonResponse(400, { error: '맡길 목표를 확인해 주세요.', code: 'CORE_GOAL_INVALID' });
        if (!requestIdPattern.test(requestId)) return jsonResponse(400, { error: '요청 식별자를 확인해 주세요.', code: 'CORE_REQUEST_ID_INVALID' });
        const serviceTier = body?.serviceTier === undefined ? undefined : String(body.serviceTier).toUpperCase();
        const interactionKind = body?.interactionKind === undefined ? undefined : String(body.interactionKind).toUpperCase();
        if (serviceTier !== undefined && !serviceTiers.has(serviceTier)) return jsonResponse(400, { error: '분석 수준을 확인해 주세요.', code: 'CORE_SERVICE_TIER_INVALID' });
        if (interactionKind !== undefined && !interactionKinds.has(interactionKind)) return jsonResponse(400, { error: '요청 유형을 확인해 주세요.', code: 'CORE_INTERACTION_KIND_INVALID' });
        if (body?.ultraApproved !== undefined && typeof body.ultraApproved !== 'boolean') return jsonResponse(400, { error: 'Ultra 승인 값을 확인해 주세요.', code: 'CORE_ULTRA_APPROVAL_INVALID' });
        let fileManifests;
        try { fileManifests = normalizeFileManifests(body?.fileManifests); }
        catch (error) { return jsonResponse(error.status || 400, { error: '파일 정보를 확인해 주세요.', code: 'CORE_FILE_MANIFEST_INVALID' }); }
        const result = safeObject(await transport.submit({
          schemaVersion: '1.0',
          contract: FOUNDER_LIVE_CONTRACT,
          downstreamCapabilities: [...FOUNDER_LIVE_DOWNSTREAM],
          requestId,
          goal: title,
          interactionKind,
          serviceTier,
          ultraApproved: body?.ultraApproved,
          fileManifests,
          actorRef,
          workspaceRef,
          source: {
            channel: sourceChannel,
            origin: String(context.sourceOrigin || ''),
            sha: sourceSha
          }
        }), 'CORE_DISPATCH_ACK_INVALID');
        if (!result.task) {
          throw Object.assign(new Error('CORE_DISPATCH_ACK_INVALID'), { status: 502 });
        }
        return jsonResponse(result.reused === true ? 200 : 201, {
          ...result,
          task: normalizeCoreTask(result.task)
        });
      }
      const receiptMatch = method === 'GET' && /^\/api\/receipts\/([^/]+)$/.exec(apiPath);
      if (receiptMatch) {
        const receiptId = decodeURIComponent(receiptMatch[1]);
        if (!receiptIdPattern.test(receiptId)) return jsonResponse(404, { error: '영수증을 찾지 못했습니다.' });
        const result = safeObject(await transport.readReceipt({ actorRef, workspaceRef, receiptId }), 'CORE_RECEIPT_INVALID');
        return jsonResponse(200, result);
      }
      return jsonResponse(404, { error: '실제 Core에서 아직 지원하지 않는 요청입니다.', code: 'CORE_API_NOT_WIRED' });
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
      return jsonResponse(status, {
        error: status < 500 ? String(error.message || 'Core 요청을 처리하지 못했습니다.') : '실제 THE FA Core 요청을 처리하지 못했습니다.',
        code: status < 500 ? 'CORE_REQUEST_REJECTED' : 'CORE_INGRESS_UNAVAILABLE'
      });
    }
  }

  return { ready, executeApi };
}
