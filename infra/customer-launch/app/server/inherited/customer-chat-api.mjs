import {
  workspaceOverview, conversationDetail, mutateCustomerChat, safeChatActionName
} from './customer-chat-domain.mjs';
import { createTenantCloudPersistence } from './customer-tenant-storage.mjs';
import { reserveCustomerChatTurn,commitCustomerChatTurn,pauseCustomerChatTurn } from './customer-chat-turn.mjs';

const json = (status, value) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store' }, body: JSON.stringify(value) });
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const routeConversation = /^\/api\/customer\/conversations\/(chat_[0-9a-f-]{36})$/;
const deepseekRoutes=['AUTO','CLOUD_FIRST'],deepseekTiers=['AUTO','STANDARD'];
function unsupportedDeepSeekMode(settings={}){
  if(!deepseekTiers.includes(settings.aiTier??'AUTO'))return 'AI_TIER_NOT_CONNECTED';
  if(!deepseekRoutes.includes(settings.route??'AUTO'))return 'LOCAL_ONLY_PROVIDER_NOT_CONNECTED';
  return null;
}
function safeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'CUSTOMER_ACTION_BODY_INVALID');
  const keys = Object.keys(body);
  if (keys.some(key => !['action','payload','requestId'].includes(key))) throw fail(400, 'CUSTOMER_ACTION_BODY_INVALID');
  return { action: safeChatActionName(body.action),
    payload: body.payload ?? {}, requestId: body.requestId };
}
export async function executeCustomerChatApi(path, method = 'GET', body,
  { email, env = {}, persistenceFactory, aiExecutionReady = false, provider = null } = {}) {
  if (typeof email !== 'string' || !email) return json(401, { code: 'AUTH_REQUIRED' });
  if (env.CORE_CONSOLE_STORAGE_MODE !== 'tenant-v3')
    return json(503, { code: 'CUSTOMER_WORKSPACE_STORAGE_NOT_READY',
      message: '고객별 대화 저장소를 연결하기 전입니다.' });
  if (typeof env.CORE_CUSTOMER_TENANT_HMAC_KEY !== 'string'
      || env.CORE_CUSTOMER_TENANT_HMAC_KEY.length < 32)
    return json(503, { code: 'CUSTOMER_TENANT_BINDING_NOT_READY' });

  // No new Worker, Router or provider is created. This API ONLY stores chat metadata and drafts.
  let store=null;
  try {
    const storage = persistenceFactory
      ? persistenceFactory(email, env)
      : createTenantCloudPersistence({email,tenantKey:env.CORE_CUSTOMER_TENANT_HMAC_KEY,
        url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY});
    if(!storage?.store || typeof storage.store.init !== 'function')
      return json(503,{code:'CUSTOMER_WORKSPACE_UNAVAILABLE'});
    store=storage.store;
    await store.init();
    // A developer-only, injected provider can be tested on laptop loopback.
    // Production has no injected provider and MUST NOT claim this is an official Core WorkUnit.
    const explicitIsolatedGuest = env.CORE_GUEST_LAN_TRIAL === 'true'
      && env.CORE_CONSOLE_AUDIENCE === 'customer-public'
      && env.CORE_GUEST_PUBLIC_AI_ALLOWLIST === 'LOCAL_4060_4204_ONLY';
    const canary = provider?.mode === 'ISOLATED_LOCAL_CANARY'
      && env.CORE_CUSTOMER_CANARY_MODE === 'ISOLATED_LAPTOP_LOOPBACK'
      && (env.CORE_CONSOLE_AUDIENCE !== 'customer-public' || explicitIsolatedGuest);
    const deepseek=provider?.mode==='DEEPSEEK_CUSTOMER_CHAT' &&
      env.CORE_CUSTOMER_DEEPSEEK_ENABLED==='true' &&
      env.CORE_CONSOLE_AUDIENCE==='customer-public';
    if (method === 'GET' && path === '/api/customer/workspace') {
      const view=workspaceOverview(store.state,{serviceReady:aiExecutionReady});
      view.capabilities.localAiCanaryAvailable=Boolean(canary);
      view.capabilities.localAiState=canary?'ISOLATED_LOCAL_TEST_ONLY':'NOT_CONNECTED';
      if(deepseek){view.capabilities.chatAiReady=true;
        view.capabilities.modelProvider='DEEPSEEK_API';view.capabilities.modelName=provider.model;
        view.capabilities.supportedRoutes=[...deepseekRoutes];view.capabilities.supportedAiTiers=[...deepseekTiers];}
      return json(200,view);
    }
    if (method === 'POST' && path === '/api/customer/chat/send') {
      if(!canary&&!deepseek) return json(503,{code:'CUSTOMER_AI_PROVIDER_NOT_CONNECTED'});
      const modeProblem=deepseek?unsupportedDeepSeekMode(store.state.customerChat?.settings):null;
      if(modeProblem)return json(409,{code:modeProblem});
      if(!body || typeof body!=='object' || Array.isArray(body) ||
         Object.keys(body).some(k=>!['conversationId','content','requestId'].includes(k)))
        return json(400,{code:'CUSTOMER_CHAT_SEND_BODY_INVALID'});
      const reservation=await store.mutate(state=>reserveCustomerChatTurn(state,body));
      if(reservation.reused){
        if(reservation.phase==='MODEL_REQUEST_PENDING')
          return json(409,{code:'CHAT_MODEL_REQUEST_IN_PROGRESS'});
        if(reservation.phase==='MODEL_REQUEST_PAUSED')
          return json(409,{code:'CHAT_MODEL_REQUEST_PAUSED_NO_AUTOREPLAY'});
        const message=conversationDetail(store.state,reservation.conversationId);
        const original=message.messages.find(m=>m.id===reservation.userMessageId);
        const reply=message.messages.find(m=>m.id===reservation.assistantMessageId);
        if(!original||!reply)return json(503,{code:'CHAT_RESULT_RECONCILE_REQUIRED'});
        return json(200,{reused:true,userMessage:original,assistantMessage:reply,
          verifiedCoreReceipt:false});
      }
      let answer;
      try{answer=await provider.ask({messages:reservation.messages});}
      catch(error) {
        try{await store.mutate(state=>pauseCustomerChatTurn(state,{
          requestId:body.requestId,userMessageId:reservation.userMessageId}));}
        catch {return json(503,{code:'CHAT_MODEL_STATE_RECONCILIATION_REQUIRED'});}
        return json(error.status===402?402:error.status===429?429:503,{code:error.status===402?'PLAN_REQUIRED':error.status===429?
          'CUSTOMER_DAILY_LIMIT_REACHED':'CHAT_MODEL_CALL_FAILED_NOT_REPLAYED'});
      }
      const committed=await store.mutate(state=>commitCustomerChatTurn(state,{
        requestId:body.requestId,userMessageId:reservation.userMessageId,result:answer}));
      return json(200,{...committed,modelExecution:deepseek?'ACTUAL_DEEPSEEK_RESPONSE':'ACTUAL_OLLAMA_RESPONSE',
        model:answer.model,costVerified:false,verifiedCoreReceipt:false});
    }
    if (method === 'GET') {
      const found = routeConversation.exec(path);
      if (found) return json(200, { conversation: conversationDetail(store.state, found[1]) });
    }
    if (method === 'POST' && path === '/api/customer/action') {
      const { action, payload, requestId } = safeRequest(body);
      if(deepseek&&action==='settings.update'){
        const target={...(store.state.customerChat?.settings||{}),...payload};
        if(['LOCAL_FIRST','LOCAL_ONLY'].includes(payload.route)||['EXPERT','ULTRA'].includes(payload.aiTier))
          return json(409,{code:unsupportedDeepSeekMode(target)||'AI_MODE_NOT_CONNECTED'});
      }
      if (action === 'message.draft' && aiExecutionReady)
        return json(409, { code: 'SEND_VIA_VERIFIED_AI_ADAPTER_REQUIRED' });
      const result = await store.mutate(state => mutateCustomerChat(state, action, payload, requestId));
      return json(action.endsWith('.create') ? 201 : 200, result);
    }
    return json(404, { code: 'CUSTOMER_ROUTE_NOT_FOUND' });
  } catch (error) {
    const allowed = new Set(['WORKSPACE_DATA_INVALID','PROJECT_NOT_FOUND','CONVERSATION_NOT_FOUND',
      'CONVERSATION_ID_INVALID','PROJECT_ID_INVALID','PROJECT_TITLE_INVALID',
      'PROJECT_INSTRUCTIONS_INVALID','CONVERSATION_TITLE_INVALID',
      'PROJECT_LIMIT_REACHED','CONVERSATION_LIMIT_REACHED','MESSAGE_LIMIT_REACHED',
      'REQUEST_ID_INVALID','IDEMPOTENCY_CONFLICT','WORKSPACE_IDEMPOTENCY_LIMIT',
      'CUSTOMER_ACTION_INVALID','CUSTOMER_ACTION_NOT_ALLOWED','CUSTOMER_ACTION_BODY_INVALID',
      'MESSAGE_CONTENT_INVALID','AI_TIER_INVALID','AI_ROUTE_INVALID',
      'AVA_ROLE_INVALID','AVA_MEMORY_SCOPE_INVALID','AVA_PERMISSIONS_INVALID',
      'AVA_BUDGET_INVALID','AVA_INSTRUCTIONS_INVALID','PAYLOAD_INVALID',
      'AVA_PROFILE_REVISION_INVALID','AVA_PROFILE_REVISION_CONFLICT']);
    for(const code of ['CUSTOMER_SEND_INVALID','SEND_REQUEST_CONFLICT','CHAT_TURN_LIMIT_REACHED',
      'CONVERSATION_MESSAGE_LIMIT','CHAT_MODEL_REQUEST_IN_PROGRESS'])allowed.add(code);
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500
        && allowed.has(error.code || error.message))
      return json(error.status, { code: error.code || error.message });
    return json(503, { code: 'CUSTOMER_WORKSPACE_UNAVAILABLE' });
  } finally {
    if(store && typeof store.close === 'function')
      try { await store.close(); } catch { /* Keep a successful committed write distinct from lease cleanup failure. */ }
  }
}
