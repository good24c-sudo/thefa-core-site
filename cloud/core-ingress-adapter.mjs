import { createHash } from 'node:crypto';

export const FOUNDER_LIVE_CONTRACT = 'founder_live_ingress_contract_v1';
export const FOUNDER_LIVE_DOWNSTREAM = Object.freeze([
  'THE_FA_MOBILE_DEVELOPMENT_ENTRY_V1',
  'THE_FA_WORK_UNIT_API_V2'
]);

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
const receiptIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/;
const shaPattern = /^[0-9a-f]{40}$/;

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
  workspaceRef = 'P04:00_v25:THE_FA_CORE_FOUNDER_LIVE_V1'
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
