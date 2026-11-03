import { randomUUID, createHash } from 'node:crypto';

const allowedModes = new Set(['AUTO', 'LOCAL_FIRST', 'LOCAL_ONLY', 'CLOUD_FIRST']);
const allowedTiers = new Set(['AUTO', 'STANDARD', 'EXPERT', 'ULTRA']);
const avaRoles = new Set(['기획', '개발', '디자인', '사업', '검토']);
const avaMemory = new Set(['선택한 프로젝트만', '현재 대화만', '사용자가 명시한 자료만']);
const avaPermissions = new Set(['읽기·초안', '읽기만', '승인 후 외부 실행']);
const avaBudgets = new Set(['유료 실행 전 승인', '외부 유료 AI 사용 안 함', '확인된 한도 안에서만']);

const idProject = /^proj_[0-9a-f-]{36}$/;
const idConversation = /^chat_[0-9a-f-]{36}$/;
const requestPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_PROJECTS = 40, MAX_CONVERSATIONS = 300, MAX_MESSAGES = 160;
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const check = (yes, status, code) => { if (!yes) throw fail(status, code); };
function str(value, min, max, code) {
  check(typeof value === 'string', 400, code);
  const result = value.trim();
  check(result.length >= min && result.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result), 400, code);
  return result;
}
function optionalId(value, pattern, code) {
  if (value == null) return null;
  check(typeof value === 'string' && pattern.test(value), 400, code);
  return value;
}
export function customerChatState(state, { initialize = false } = {}) {
  check(state && typeof state === 'object' && !Array.isArray(state), 503, 'WORKSPACE_STATE_INVALID');
  if (state.customerChat == null && initialize) {
    state.customerChat = {
      version: 1, projects: [], conversations: [],
      settings: {
        aiTier: 'AUTO', route: 'AUTO',
        ava: { version: 'AVA_V1_DRAFT', role: '기획', memoryScope: '선택한 프로젝트만',
          permissions: '읽기·초안', budget: '유료 실행 전 승인', instructions: '' }
      },
      idempotency: {}
    };
  }
  const value = state.customerChat;
  if (!value) return { version: 1, projects: [], conversations: [],
    settings: { aiTier: 'AUTO', route: 'AUTO', ava: null }, idempotency: {} };
  check(value.version === 1 && Array.isArray(value.projects)
    && Array.isArray(value.conversations) && value.settings && typeof value.settings === 'object'
    && value.idempotency && typeof value.idempotency === 'object' && !Array.isArray(value.idempotency),
    503, 'WORKSPACE_DATA_INVALID');
  return value;
}
function findProject(workspace, id) {
  const project = workspace.projects.find(p => p.id === id);
  check(project != null, 404, 'PROJECT_NOT_FOUND');
  return project;
}
function findConversation(workspace, id, { includeArchived = false } = {}) {
  check(typeof id === 'string' && idConversation.test(id), 400, 'CONVERSATION_ID_INVALID');
  const conversation = workspace.conversations.find(c => c.id === id && (includeArchived || !c.archivedAt));
  check(conversation != null, 404, 'CONVERSATION_NOT_FOUND');
  return conversation;
}
const summarize = c => ({
  id: c.id, projectId: c.projectId, title: c.title,
  createdAt: c.createdAt, updatedAt: c.updatedAt,
  archivedAt: c.archivedAt, messageCount: c.messages.length,
  lastMessage: c.messages.at(-1)?.content.slice(0, 100) || ''
});
export function workspaceOverview(state, { serviceReady = false } = {}) {
  const w = customerChatState(state);
  return {
    contract: 'THEFA_CUSTOMER_CHAT_V2',
    persistence: 'TENANT_V3_SESSION_BOUND_NOT_CROSS_TENANT_VERIFIED',
    projects: w.projects.map(p => ({ ...p })),
    conversations: w.conversations.filter(c => !c.archivedAt)
      .map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    settings: clone(w.settings),
    capabilities: {
      chatAiReady: Boolean(serviceReady),
      localPcPaired: false,
      localAiState: 'NOT_CONNECTED',
      actualCloudCost: null, verifiedCostSaving: null,
      avaExecutionReady: false,
      pendingApprovalCount: null,
      receiptsSource: 'EXISTING_CORE_ONLY',
      note: 'AI 응답·비용 절감은 실제 연결과 영수증으로만 확인합니다.'
    }
  };
}
export function conversationDetail(state, id) {
  const w = customerChatState(state);
  return clone(findConversation(w, id));
}
function idempotent(w, key, content, operation) {
  check(requestPattern.test(String(key ?? '')), 400, 'REQUEST_ID_INVALID');
  const digest = createHash('sha256').update(JSON.stringify({ content, operation })).digest('hex');
  const found = w.idempotency[key];
  if (found) {
    check(found.digest === digest, 409, 'IDEMPOTENCY_CONFLICT');
    return { alreadyExists: true, response: clone(found.response) };
  }
  // Preserve recent request keys, prune only completed metadata requests older than 24h.
  // This is NOT the durable idempotency ledger for paid models / external WorkUnits.
  const oldest=Date.now()-24*60*60*1000;
  for(const [storedKey,entry] of Object.entries(w.idempotency)){
    const at=Date.parse(entry?.createdAt||'');
    if(!Number.isFinite(at)||at<oldest)delete w.idempotency[storedKey];
  }
  check(Object.keys(w.idempotency).length < 600, 429, 'WORKSPACE_IDEMPOTENCY_LIMIT');
  return { digest };
}
export function mutateCustomerChat(state, action, payload = {}, requestId) {
  // Copy-on-write reducer: invalid multi-field updates must never partially mutate caller state.
  const w = clone(customerChatState(state));
  check(payload && typeof payload === 'object' && !Array.isArray(payload), 400, 'PAYLOAD_INVALID');
  const dup = idempotent(w, requestId, payload, action);
  if (dup.alreadyExists) return { ...dup.response, reused: true };
  const t = now();
  let response;
  switch (action) {
    case 'project.create': {
      check(w.projects.length < MAX_PROJECTS, 429, 'PROJECT_LIMIT_REACHED');
      const title = str(payload.title, 1, 80, 'PROJECT_TITLE_INVALID');
      const project = { id: 'proj_' + randomUUID(), title, instructions: '', createdAt: t, updatedAt: t };
      w.projects.push(project);
      response = { project: clone(project) };
      break;
    }
    case 'project.update': {
      const project = findProject(w, optionalId(payload.projectId, idProject, 'PROJECT_ID_INVALID'));
      if (payload.title !== undefined) project.title = str(payload.title, 1, 80, 'PROJECT_TITLE_INVALID');
      if (payload.instructions !== undefined) project.instructions = str(payload.instructions, 0, 2000, 'PROJECT_INSTRUCTIONS_INVALID');
      project.updatedAt = t;
      response = { project: clone(project) };
      break;
    }
    case 'conversation.create': {
      check(w.conversations.length < MAX_CONVERSATIONS, 429, 'CONVERSATION_LIMIT_REACHED');
      const projectId = optionalId(payload.projectId, idProject, 'PROJECT_ID_INVALID');
      if (projectId) findProject(w, projectId);
      const title = payload.title == null ? '새 대화' : str(payload.title, 1, 100, 'CONVERSATION_TITLE_INVALID');
      const conversation = { id: 'chat_' + randomUUID(), title, projectId,
        messages: [], createdAt: t, updatedAt: t, archivedAt: null };
      w.conversations.push(conversation);
      response = { conversation: summarize(conversation) };
      break;
    }
    case 'conversation.update': {
      const conversation = findConversation(w, payload.conversationId);
      if (payload.title !== undefined) conversation.title = str(payload.title, 1, 100, 'CONVERSATION_TITLE_INVALID');
      if (payload.projectId !== undefined) {
        const projectId = optionalId(payload.projectId, idProject, 'PROJECT_ID_INVALID');
        if (projectId) findProject(w, projectId);
        conversation.projectId = projectId;
      }
      conversation.updatedAt = t;
      response = { conversation: summarize(conversation) };
      break;
    }
    case 'conversation.archive': {
      const conversation = findConversation(w, payload.conversationId);
      conversation.archivedAt = t;
      conversation.updatedAt = t;
      response = { conversation: summarize(conversation) };
      break;
    }
    case 'message.draft': {
      const conversation = findConversation(w, payload.conversationId);
      check(conversation.messages.length < MAX_MESSAGES, 429, 'MESSAGE_LIMIT_REACHED');
      const content = str(payload.content, 1, 8000, 'MESSAGE_CONTENT_INVALID');
      const message = { id: 'msg_' + randomUUID(), role: 'user', content,
        createdAt: t, state: 'DRAFT_NOT_DISPATCHED', dispatch: 'NONE', receiptId: null };
      conversation.messages.push(message);
      if (conversation.title === '새 대화') conversation.title = content.slice(0, 45);
      conversation.updatedAt = t;
      response = { conversation: summarize(conversation), message: clone(message),
        aiExecution: 'NOT_STARTED', reason: 'CUSTOMER_AI_NOT_CONNECTED' };
      break;
    }
    case 'settings.update': {
      if (payload.aiTier !== undefined) {
        check(allowedTiers.has(payload.aiTier), 400, 'AI_TIER_INVALID');
        w.settings.aiTier = payload.aiTier;
      }
      if (payload.route !== undefined) {
        check(allowedModes.has(payload.route), 400, 'AI_ROUTE_INVALID');
        w.settings.route = payload.route;
      }
      response = { settings: clone(w.settings), saved: true, aiActuallyConnected: false };
      break;
    }
    case 'ava.update': {
      // One persistent personal AVA per tenant: roles are capabilities, not independent selves.
      const ava = w.settings.ava || { version: 'AVA_V1_DRAFT' };
      // Optional for legacy callers; current UI always binds edits to the rendered revision.
      if (Object.hasOwn(payload, 'expectedProfileRevision')) {
        check(Number.isSafeInteger(payload.expectedProfileRevision) && payload.expectedProfileRevision >= 0,
          400, 'AVA_PROFILE_REVISION_INVALID');
        const currentRevision = ava.profileRevision ?? 0;
        check(Number.isSafeInteger(currentRevision) && currentRevision >= 0,
          503, 'AVA_REVISION_CORRUPT');
        check(payload.expectedProfileRevision === currentRevision,
          409, 'AVA_PROFILE_REVISION_CONFLICT');
      }
      if (payload.role !== undefined) {
        const role = str(payload.role, 1, 80, 'AVA_ROLE_INVALID');
        check(avaRoles.has(role), 400, 'AVA_ROLE_INVALID');
        ava.role = role;
      }
      if (payload.memoryScope !== undefined) {
        const scope = str(payload.memoryScope, 1, 160, 'AVA_MEMORY_SCOPE_INVALID');
        check(avaMemory.has(scope), 400, 'AVA_MEMORY_SCOPE_INVALID');
        ava.memoryScope = scope;
      }
      if (payload.permissions !== undefined) {
        const permissions = str(payload.permissions, 1, 160, 'AVA_PERMISSIONS_INVALID');
        check(avaPermissions.has(permissions), 400, 'AVA_PERMISSIONS_INVALID');
        ava.permissions = permissions;
      }
      if (payload.budget !== undefined) {
        const budget = str(payload.budget, 1, 160, 'AVA_BUDGET_INVALID');
        check(avaBudgets.has(budget), 400, 'AVA_BUDGET_INVALID');
        ava.budget = budget;
      }
      if (payload.instructions !== undefined) ava.instructions = str(payload.instructions, 0, 2000, 'AVA_INSTRUCTIONS_INVALID');
      if (ava.identityId !== undefined) {
        check(/^myava_[0-9a-f-]{36}$/.test(ava.identityId), 503, 'AVA_IDENTITY_CORRUPT');
      } else {
        ava.identityId = 'myava_' + randomUUID();
        ava.createdAt = t;
      }
      const priorRevision = ava.profileRevision ?? 0;
      check(Number.isSafeInteger(priorRevision) && priorRevision >= 0 &&
        priorRevision < Number.MAX_SAFE_INTEGER, 503, 'AVA_REVISION_CORRUPT');
      ava.profileRevision = priorRevision + 1;
      ava.updatedAt = t;
      ava.identityContract = 'ONE_MY_AVA_ROLE_AS_CAPABILITY';
      ava.memorySharing = 'PRIVATE_BY_DEFAULT_NO_SHARE';
      ava.executionReady = false;
      ava.pcAccess = false;
      ava.version = 'AVA_V1_DRAFT';
      w.settings.ava = ava;
      response = { ava: clone(ava), saved: true, executable: false, shared: false };
      break;
    }
    default: throw fail(404, 'CUSTOMER_ACTION_NOT_ALLOWED');
  }
  w.idempotency[requestId] = { digest: dup.digest, response: clone(response), createdAt: t };
  state.customerChat=w;
  return { ...response, reused: false };
}
export function safeChatActionName(action) {
  check(typeof action === 'string' && /^[a-z]+\.[a-z]+$/.test(action), 400, 'CUSTOMER_ACTION_INVALID');
  check(['project.create', 'project.update','conversation.create','conversation.update',
    'conversation.archive','message.draft','settings.update','ava.update'].includes(action),
    404, 'CUSTOMER_ACTION_NOT_ALLOWED');
  return action;
}
