/**
 * THE FA Core × AVA World isolated SYNTHETIC preview engine.
 * No network, browser storage, real identity, crypto key or external side effects.
 * This module DOES NOT substitute for P07 M2.25 authoritative code or P04 authentication.
 */
export const DEMO_CONTRACT='THEFA_AVA_WORLD_SYNTHETIC_PREVIEW_R1';
export const SOURCES=Object.freeze([
 {id:'phone-01',device:'PHONE',date:'2026-10-21',source:'휴대폰 기록 예시',topic:'사업 계획',text:'카페 신규 점포 조사에서는 출처와 표본 수를 먼저 확인한다.',tags:['사업','카페','점포','조사'],revision:1},
 {id:'pc-01',device:'PC',date:'2026-10-22',source:'PC 작업 기록 예시',topic:'개발 원칙',text:'신규 코드보다 기존 검증 자산을 우선 재사용하기로 결정했다.',tags:['개발','코드','자산','재사용'],revision:1},
 {id:'phone-02',device:'PHONE',date:'2026-10-23',source:'휴대폰 기록 예시',topic:'업무 우선순위',text:'이번 주 첫 작업은 기존 사용자 자료를 보호하는 것이다.',tags:['이번 주','업무','보호','자료'],revision:1}
]);
const clean=()=>({epoch:0,consent:{memory:false,world:false,share:false},memories:[],revokedAt:null,events:[],changed:false});
const copy=obj=>JSON.parse(JSON.stringify(obj));
const NOW='2026-11-12T09:00:00+09:00'; // labelled synthetic timestamp, not runtime evidence
const statusText={APPROVED:'승인',PENDING:'재승인 대기',REVOKED:'사용 중지'};
export function createDemoAva(){
 let state=clean();
 function track(name,meta={}){state.events.push({event:name,syntheticTime:NOW,...meta});}
 function invalidate(reason){state.epoch++;state.changed=true;track('CACHE_INVALIDATED',{reason,epoch:state.epoch});}
 function snapshot(){
  return copy({...state,memories:state.memories.map(m=>({...m,statusLabel:statusText[m.status]??m.status})),demoOnly:true,realAccountConnected:false,cloudRequests:0,worldPublications:0});
 }
 function consent(kind,enabled){
  if(!Object.hasOwn(state.consent,kind)||typeof enabled!=='boolean')throw Error('CONSENT_INVALID');
  if(kind==='world'&&enabled&&!state.consent.memory)throw Error('MEMORY_CONSENT_REQUIRED_FOR_DEMO_WORLD');
  if(kind==='share'&&enabled&&(!state.consent.world||!state.consent.memory))throw Error('WORLD_CONSENT_REQUIRED_FOR_SHARE');
  if(state.consent[kind]===enabled)return snapshot();
  state.consent[kind]=enabled;
  if(kind==='memory'&&!enabled){
   state.memories=[];state.consent.world=false;state.consent.share=false;
   state.revokedAt=NOW;invalidate('MEMORY_CONSENT_REVOKED');
  }else if(kind==='world'&&!enabled){
   state.consent.share=false;invalidate('WORLD_ENTRY_REVOKED');
  }else if(kind==='share'&&!enabled){
   invalidate('WORLD_PUBLICATION_CONSENT_REVOKED');
  }else{
   invalidate('CONSENT_CHANGED_'+kind.toUpperCase());
  }
  track('CONSENT_CHANGED',{kind,enabled,synthetic:true});
  return snapshot();
 }
 function seed(){
  if(!state.consent.memory)throw Error('MEMORY_CONSENT_REQUIRED');
  if(state.memories.length)return snapshot();
  state.memories=SOURCES.map(m=>({...m,status:'APPROVED',approvedEpoch:state.epoch}));
  track('SYNTHETIC_MEMORY_SEEDED',{count:state.memories.length});
  return snapshot();
 }
 function choose(id){return state.memories.find(m=>m.id===id)}
 function correct(id,revisionText){
  if(!state.consent.memory)throw Error('MEMORY_NOT_ALLOWED');
  const item=choose(id);
  if(!item||item.status!=='APPROVED')throw Error('APPROVED_MEMORY_REQUIRED');
  if(typeof revisionText!=='string'||revisionText.trim().length<6||revisionText.length>350)throw Error('CORRECTION_INVALID');
  item.text=revisionText.trim();item.revision++;item.status='PENDING';delete item.approvedEpoch;
  // A corrected memory invalidates any stale authority and any derived knowledge.
  state.consent.world=false;state.consent.share=false;
  invalidate('MEMORY_CORRECTION_PENDING_REAPPROVAL');
  track('SYNTHETIC_CORRECTION',{id,revision:item.revision});
  return snapshot();
 }
 function approve(id){
  if(!state.consent.memory)throw Error('MEMORY_NOT_ALLOWED');
  const item=choose(id);
  if(!item||item.status!=='PENDING')throw Error('PENDING_MEMORY_REQUIRED');
  invalidate('MEMORY_APPROVED_FRESH_EPOCH');
  item.status='APPROVED';item.approvedEpoch=state.epoch;
  track('SYNTHETIC_REAPPROVED',{id,epoch:state.epoch});
  return snapshot();
 }
 function answer(question,{device='ALL',owner='DEMO_OWNER',tokenEpoch=state.epoch}={}){
  if(owner!=='DEMO_OWNER')return {status:'DENIED',reason:'OWNER_SCOPE_DENIED'};
  if(!['ALL','PHONE','PC'].includes(device))return {status:'DENIED',reason:'DEVICE_SCOPE_INVALID'};
  if(tokenEpoch!==state.epoch)return {status:'STALE_SESSION',reason:'EPOCH_CHANGED'};
  if(!state.consent.memory)return {status:'DENIED',reason:'MEMORY_CONSENT_REQUIRED'};
  if(typeof question!=='string'||question.trim().length<2||question.length>400)return {status:'DENIED',reason:'QUESTION_INVALID'};
  const q=question.trim().toLowerCase();
  const eligible=state.memories.filter(m=>m.status==='APPROVED'&&(device==='ALL'||m.device===device));
  const broad=new Set(['개발','업무','조사','자료','보호']);
  const match=eligible.find(m=>m.tags.some(t=>!broad.has(t.toLowerCase())&&q.includes(t.toLowerCase())));
  if(!match)return {status:'NO_GROUNDED_ANSWER',reason:'APPROVED_EVIDENCE_NOT_FOUND',sourceCount:eligible.length};
  return {status:'GROUNDED',text:match.text,source:match.source,sourceDate:match.date,
    device:match.device,memoryId:match.id,revision:match.revision,epoch:state.epoch,synthetic:true,
    explanation:'승인된 합성 기록을 그대로 표시했습니다. 생성형 추론이나 실제 개인 기억 검색은 아닙니다.'};
 }
 function enterWorld({owner='DEMO_OWNER',tokenEpoch=state.epoch}={}){
  if(owner!=='DEMO_OWNER')return {status:'DENIED',reason:'OWNER_SCOPE_DENIED'};
  if(tokenEpoch!==state.epoch)return {status:'STALE_SESSION',reason:'EPOCH_CHANGED'};
  if(!state.consent.memory||!state.consent.world)return {status:'DENIED',reason:'WORLD_ENTRY_CONSENT_REQUIRED'};
  if(!state.memories.some(m=>m.status==='APPROVED'))return {status:'DENIED',reason:'APPROVED_MEMORY_REQUIRED'};
  return {status:'SYNTHETIC_WORLD_PREVIEW_ALLOWED',realWorld:false,memoryShared:false,epoch:state.epoch};
 }
 function requestPublication(){
  // Even with consent this candidate has no provenance, rights or real publishing backend.
  return {status:'BLOCKED_NOT_IMPLEMENTED',reason:'INDEPENDENT_VERIFICATION_AND_LICENSE_REQUIRED',realPublication:false};
 }
 return Object.freeze({snapshot,consent,seed,correct,approve,answer,enterWorld,requestPublication});
}
