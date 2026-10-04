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
        downstream_capabilities: value.downstreamCapabilities
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
        const state = safeObject(await transport.readState({ actorRef, workspaceRef }), 'CORE_STATE_INVALID');
        return jsonResponse(200, state);
      }
      if (apiPath === '/api/tasks' && method === 'POST') {
        const title = typeof body?.title === 'string' ? body.title.trim() : '';
        const requestId = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        if (!title || title.length > 4000) return jsonResponse(400, { error: '맡길 목표를 확인해 주세요.', code: 'CORE_GOAL_INVALID' });
        if (!requestIdPattern.test(requestId)) return jsonResponse(400, { error: '요청 식별자를 확인해 주세요.', code: 'CORE_REQUEST_ID_INVALID' });
        const result = safeObject(await transport.submit({
          schemaVersion: '1.0',
          contract: FOUNDER_LIVE_CONTRACT,
          downstreamCapabilities: [...FOUNDER_LIVE_DOWNSTREAM],
          requestId,
          goal: title,
          actorRef,
          workspaceRef,
          source: {
            channel: sourceChannel,
            origin: String(context.sourceOrigin || ''),
            sha: sourceSha
          }
        }), 'CORE_DISPATCH_ACK_INVALID');
        return jsonResponse(result.reused === true ? 200 : 201, result);
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
