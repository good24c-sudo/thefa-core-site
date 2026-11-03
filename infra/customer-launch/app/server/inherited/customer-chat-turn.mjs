import { createHash, randomUUID } from 'node:crypto';
import { customerChatState } from './customer-chat-domain.mjs';

const bad=(status,code)=>Object.assign(new Error(code),{status,code});
const pattern=/^[a-zA-Z0-9._:-]{8,128}$/;
const conversationPattern=/^chat_[0-9a-f-]{36}$/;
const clone=s=>structuredClone(s);
const sum=v=>createHash('sha256').update(v).digest('hex');
const now=()=>new Date().toISOString();
function validate({conversationId,requestId,content}){
  if(!conversationPattern.test(String(conversationId)) ||
     !pattern.test(String(requestId)) || typeof content!=='string' ||
     !content.trim() || content.trim().length>4000)
    throw bad(400,'CUSTOMER_SEND_INVALID');
  return content.trim();
}
function findConversation(w,id,{includeArchived=false}={}){
  const c=w.conversations.find(x=>x.id===id&&(includeArchived||!x.archivedAt));
  if(!c)throw bad(404,'CONVERSATION_NOT_FOUND');
  return c;
}
function contextFor(w,c,upto) {
  const history=c.messages.filter(v=>v.id!==upto &&
    (v.role==='user'&&(v.state==='SENT_TO_MODEL'||v.state==='DRAFT_NOT_DISPATCHED')) ||
    v.role==='assistant'&&v.state==='MODEL_RESPONSE_RECEIVED_UNVERIFIED');
  // Never forward stale, paused, unverified provider internals or unrelated projects.
  const previous=history.slice(-16).map(m=>({role:m.role,content:String(m.content).slice(0,3500)}));
  let size=previous.reduce((n,m)=>n+Buffer.byteLength(m.content),0);
  while(size>6500 && previous.length>0){
    const drop=previous.shift();size-=Buffer.byteLength(drop.content);
  }
  const system=['당신은 THE FA Core의 고객용 AI 대화 도우미입니다. 사용자의 언어로 명확하고 실용적으로 답하세요.',
    '실제로 확인되지 않은 파일 생성, 외부 실행, 영수증, 비용 절감을 완료라고 주장하지 마세요.'];
  if(c.projectId){
    const project=w.projects.find(p=>p.id===c.projectId);
    if(project?.instructions)system.push('프로젝트 참고 지침: '+project.instructions.slice(0,1200));
  }
  return [{role:'system',content:system.join('\n')},...previous];
}
export function reserveCustomerChatTurn(state,{conversationId,requestId,content}={}){
  const message=validate({conversationId,requestId,content});
  const w=clone(customerChatState(state,{initialize:true}));
  if(!w.turnRequests)w.turnRequests={};
  const digest=sum(JSON.stringify({conversationId,content:message}));
  const earlier=w.turnRequests[requestId];
  if(earlier){
    if(earlier.digest!==digest)throw bad(409,'SEND_REQUEST_CONFLICT');
    return {reused:true,phase:earlier.phase,conversationId,
      userMessageId:earlier.userMessageId,
      assistantMessageId:earlier.assistantMessageId||null,
      messages:null};
  }
  if(Object.keys(w.turnRequests).length>=500)throw bad(429,'CHAT_TURN_LIMIT_REACHED');
  const c=findConversation(w,conversationId);
  if(Object.values(w.turnRequests).some(t=>t.conversationId===conversationId&&t.phase==='MODEL_REQUEST_PENDING'))
    throw bad(409,'CHAT_MODEL_REQUEST_IN_PROGRESS');
  if(c.messages.length>=158)throw bad(429,'CONVERSATION_MESSAGE_LIMIT');
  const id='msg_'+randomUUID();
  const history=contextFor(w,c,id);
  c.messages.push({id,role:'user',content:message,createdAt:now(),
    state:'MODEL_REQUEST_PENDING',receiptId:null});
  if(c.title==='새 대화')c.title=message.slice(0,45);
  c.updatedAt=now();
  w.turnRequests[requestId]={digest,phase:'MODEL_REQUEST_PENDING',conversationId,
    userMessageId:id,createdAt:now(),assistantMessageId:null};
  state.customerChat=w;
  return {reused:false,phase:'MODEL_REQUEST_PENDING',conversationId,userMessageId:id,
    messages:[...history,{role:'user',content:message}]};
}
export function commitCustomerChatTurn(state,{requestId,userMessageId,result}={}){
  const w=clone(customerChatState(state));
  const turn=w.turnRequests?.[requestId];
  if(!turn||turn.userMessageId!==userMessageId)throw bad(409,'CHAT_RESERVATION_NOT_FOUND');
  if(turn.phase==='MODEL_RESPONSE_RECEIVED_UNVERIFIED'){
    const conversation=findConversation(w,turn.conversationId,{includeArchived:true});
    return {reused:true,conversationId:turn.conversationId,
      userMessage:clone(conversation.messages.find(m=>m.id===userMessageId)),
      assistantMessage:clone(conversation.messages.find(m=>m.id===turn.assistantMessageId))};
  }
  if(turn.phase!=='MODEL_REQUEST_PENDING')throw bad(409,'CHAT_RESERVATION_NOT_ACTIVE');
  const text=typeof result?.content==='string'?result.content.trim():null;
  if(!text || typeof text!=='string' || text.length>15000 ||
      typeof result?.model!=='string' || !['OLLAMA_ISOLATED_LAPTOP_CANARY','DEEPSEEK_API'].includes(result?.provider) ||
      sum(text)!==result.sha256)throw bad(502,'MODEL_RESULT_INVALID');
  const conversation=findConversation(w,turn.conversationId,{includeArchived:true});
  const original=conversation.messages.find(m=>m.id===userMessageId);
  if(!original||original.state!=='MODEL_REQUEST_PENDING')throw bad(409,'CHAT_RESERVATION_MISMATCH');
  original.state='SENT_TO_MODEL';
  const reply={id:'msg_'+randomUUID(),role:'assistant',content:text,createdAt:now(),
    state:'MODEL_RESPONSE_RECEIVED_UNVERIFIED',receiptId:null,
    model:result.model,provider:result.provider,contentSha256:result.sha256,
    promptTokens:result.promptTokens,outputTokens:result.outputTokens};
  conversation.messages.push(reply);
  conversation.updatedAt=now();
  turn.assistantMessageId=reply.id;
  turn.phase='MODEL_RESPONSE_RECEIVED_UNVERIFIED';
  turn.updatedAt=now();
  state.customerChat=w;
  return {reused:false,conversationId:turn.conversationId,userMessage:clone(original),
    assistantMessage:clone(reply),verifiedCoreReceipt:false};
}
export function pauseCustomerChatTurn(state,{requestId,userMessageId}={}){
  const w=clone(customerChatState(state));
  const turn=w.turnRequests?.[requestId];
  if(!turn||turn.userMessageId!==userMessageId)throw bad(409,'CHAT_RESERVATION_NOT_FOUND');
  if(turn.phase!=='MODEL_REQUEST_PENDING')return {phase:turn.phase};
  const c=findConversation(w,turn.conversationId,{includeArchived:true});
  const original=c.messages.find(x=>x.id===userMessageId);
  if(original)original.state='MODEL_REQUEST_PAUSED';
  turn.phase='MODEL_REQUEST_PAUSED';turn.updatedAt=now();
  c.updatedAt=now();
  state.customerChat=w;
  return {phase:turn.phase};
}
