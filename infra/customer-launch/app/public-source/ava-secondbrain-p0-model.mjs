/**
 * THE FA / AVA SecondBrain P0 — SYNTHETIC-ONLY projection over existing P07 engine.
 * No network, storage, identity, encryption, customer database, provider calls or execution.
 * This is not a replacement for the official M2.25 or G1 Vault.
 */
import {createDemoAva, DEMO_CONTRACT, SOURCES} from './ava-world-engine.mjs';

export const P0_CONTRACT='THEFA_AVA_SECONDBRAIN_SYNTHETIC_P0_V1';
export const PROFILE_SECTIONS=Object.freeze([
 {key:'profession',label:'현재 하는 일과 전문 분야',topics:['사업 계획','개발 원칙']},
 {key:'interests',label:'주요 관심 분야',topics:['사업 계획']},
 {key:'goals',label:'단기·장기 목표',topics:['업무 우선순위']},
 {key:'working',label:'선호하는 일 처리 방식',topics:['개발 원칙']},
 {key:'decisions',label:'중요한 판단 기준',topics:['사업 계획','개발 원칙']},
 {key:'projects',label:'진행 중인 프로젝트',topics:[]}
]);
export const REAL_SOURCE_STATUSES=Object.freeze([
 {id:'core-history',title:'THE FA Core 프로젝트·대화',kind:'LIVE',state:'CONNECTION_UNVERIFIED',why:'운영 계정·권한 연결 미검증'},
 {id:'private-notes',title:'내 비공개 노트',kind:'VERIFIED_MEMORY',state:'CONNECTION_UNVERIFIED',why:'실고객 노트 저장소 미연결'},
 {id:'customer-drive',title:'개인 파일·문서',kind:'LIVE',state:'CONNECTION_UNVERIFIED',why:'업로드 및 소스 인증 미연결'},
 {id:'phone',title:'Phone AVA',kind:'DEVICE',state:'CONNECTION_UNVERIFIED',why:'실기기 수집·동의·G1 검증 전'},
 {id:'pc',title:'PC AVA',kind:'DEVICE',state:'CONNECTION_UNVERIFIED',why:'실기기 수집·동의·G1 검증 전'},
 {id:'external',title:'외부 앱 커넥터',kind:'LIVE',state:'CONNECTION_UNVERIFIED',why:'실시간 소스 연결 미승인'}
]);
const DENIED=(reason)=>({status:'DENIED',reason,results:[],synthetic:true});
const plain=(x)=>JSON.parse(JSON.stringify(x));
const str=(x)=>String(x||'').trim();
const norm=(x)=>str(x).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,' ');
const STOP=new Set(['지난주','최근','이번','그때','내가','나의','무엇','어떤','알려줘','보여줘','대해','중요한','전에','이전에','내용','기록','기억','하는','했던','했던일','했지','어떻게','결정한','일은','것은','있는','전에']);
function tokens(text){return norm(text).replace(/[?!.,:()]/g,' ').split(/\s+/).filter(x=>x.length>1&&!STOP.has(x));}

export function detectEvidenceConflicts(items){
  if(!Array.isArray(items))return [];
  const groups=new Map();
  for(const item of items){
    if(item.status!=='APPROVED'||!item.claimKey)continue;
    const list=groups.get(item.claimKey)||[];
    list.push(item);groups.set(item.claimKey,list);
  }
  const collisions=[];
  for(const [claimKey,group] of groups){
    const texts=new Set(group.map(m=>norm(m.text)));
    if(texts.size<=1)continue;
    // The presence of divergent evidence is a review item, not a factual winner.
    collisions.push({status:'CONFLICT_REVIEW_REQUIRED',claimKey,
      sources:group.map(m=>({id:m.id,date:m.date||null,revision:m.revision||1,source:m.source||'UNKNOWN'})),
      resolved:false});
  }
  return collisions;
}

export function createAvaSecondBrainP0(){
  const engine=createDemoAva();
  const blockedIds=new Set();
  const aboutStates=new Map();
  let extraEpoch=0;
  function resetDerived(){blockedIds.clear();aboutStates.clear();extraEpoch++;}
  function snapshot(){
    const base=engine.snapshot();
    const memories=base.memories.map(m=>({...m,status:blockedIds.has(m.id)?'REVOKED':m.status,
      sourceRef:'SYNTHETIC:P07:'+m.id,validatedBy:'SYNTHETIC_FIXTURE_ONLY',
      evidenceAvailability:'FIXTURE',realCustomer:false}));
    return plain({...base,memories,extraEpoch,contract:P0_CONTRACT,underlyingContract:DEMO_CONTRACT,
      sourceCount:SOURCES.length,realCustomerConnected:false,realSourcesConnected:0,
      externalModelCalls:0,secretValuesUsed:0,externalActions:0});
  }
  function consentMemory(value){
    if(typeof value!=='boolean')throw Error('CONSENT_BOOLEAN_REQUIRED');
    engine.consent('memory',value);
    if(!value)resetDerived();
    else extraEpoch++;
    return snapshot();
  }
  function seed(){
    const base=engine.seed();
    extraEpoch++;
    return snapshot();
  }
  function corrected(id,text){
    if(blockedIds.has(id))throw Error('REVOKED_MEMORY_NOT_EDITABLE');
    engine.correct(id,text);
    extraEpoch++;aboutStates.clear();
    return snapshot();
  }
  function approve(id){
    if(blockedIds.has(id))throw Error('REVOKED_MEMORY_CANNOT_APPROVE');
    engine.approve(id);
    extraEpoch++;aboutStates.clear();
    return snapshot();
  }
  function revokeItem(id){
    const s=engine.snapshot();
    if(!s.consent.memory)throw Error('MEMORY_NOT_ALLOWED');
    if(!s.memories.some(m=>m.id===id))throw Error('MEMORY_ID_NOT_FOUND');
    blockedIds.add(id);extraEpoch++;aboutStates.clear();
    return snapshot();
  }
  function search(question,{device='ALL',owner='DEMO_OWNER',tokenEpoch=null,sourceIds=null}={}){
    const s=snapshot(), q=str(question);
    if(owner!=='DEMO_OWNER')return DENIED('OWNER_SCOPE_DENIED_SYNTHETIC');
    if(!['ALL','PHONE','PC'].includes(device))return DENIED('DEVICE_SCOPE_INVALID');
    if(tokenEpoch!==null && tokenEpoch!==s.epoch+':'+extraEpoch)
      return {status:'STALE_SESSION',reason:'EPOCH_CHANGED',results:[],synthetic:true};
    if(!s.consent.memory)return DENIED('MEMORY_CONSENT_REQUIRED');
    if(q.length<2||q.length>400)return DENIED('QUESTION_INVALID');
    if(sourceIds!==null && (!Array.isArray(sourceIds)||sourceIds.some(v=>typeof v!=='string')))
      return DENIED('SOURCE_FILTER_INVALID');
    const allowed=sourceIds===null?null:new Set(sourceIds);
    if(allowed&&[...allowed].some(id=>!SOURCES.some(s=>s.id===id)))
      return DENIED('SOURCE_NOT_AUTHORIZED');
    const ts=tokens(q);
    if(!ts.length)return {status:'NO_GROUNDED_ANSWER',reason:'QUESTION_TOO_VAGUE',results:[],synthetic:true};
    const eligible=s.memories.filter(m=>m.status==='APPROVED'&&!blockedIds.has(m.id)
      &&(device==='ALL'||m.device===device)&&(!allowed||allowed.has(m.id)));
    const scored=[];
    for(const m of eligible){
      // Only current revision text/topic are searchable: inherited immutable tags
      // may describe an older corrected claim and must not revive stale evidence.
      const haystack=norm([m.text,m.topic].join(' '));
      const matched=ts.filter(t=>haystack.includes(t));
      // For query-specific memory, require a meaningful matched subject. No broad fallback.
      if(!matched.length)continue;
      scored.push({m,rank:matched.length,matched});
    }
    scored.sort((a,b)=>b.rank-a.rank||String(b.m.date).localeCompare(String(a.m.date)));
    if(!scored.length)return {status:'NO_GROUNDED_ANSWER',reason:'APPROVED_EVIDENCE_NOT_FOUND',
      sourceCount:eligible.length,results:[],synthetic:true};
    const records=scored.map(({m,matched})=>({
      memoryId:m.id,sourceRef:m.sourceRef,source:m.source,sourceDate:m.date,
      device:m.device,topic:m.topic,text:m.text,revision:m.revision,approvedBy:'SYNTHETIC_FIXTURE_ONLY',
      confidence:'FIXTURE_ONLY',status:m.status,matched,validAt:m.date,synthetic:true
    }));
    return {status:'GROUNDED_SYNTHETIC',synthetic:true,epoch:s.epoch+':'+extraEpoch,
      results:records,answer:'합성 기록에서 관련 항목 '+records.length+'건을 찾았습니다. 실제 개인 기억이나 생성형 AI 답변이 아닙니다.',
      sourceCount:eligible.length,conflicts:detectEvidenceConflicts(eligible)};
  }
  function sources(){
    const s=snapshot();
    const example=SOURCES.map(item=>({id:item.id,title:item.source,kind:'SYNTHETIC_FIXTURE',
      state:!s.consent.memory?'CONSENT_REQUIRED':s.memories.some(m=>m.id===item.id)?'SYNTHETIC_READY':'SYNTHETIC_NOT_LOADED',
      device:item.device,observedAt:item.date,realConnected:false}));
    return plain([...example,...REAL_SOURCE_STATUSES]);
  }
  function profile(){
    const s=snapshot();
    return PROFILE_SECTIONS.map(sec=>{
      const evidence=s.consent.memory?s.memories.filter(m=>m.status==='APPROVED'
        &&sec.topics.includes(m.topic)):[];
      const current=aboutStates.get(sec.key);
      const candidate=evidence.length?evidence[0].text:'합성 기억에서 근거를 찾지 못했습니다.';
      return {key:sec.key,label:sec.label,candidate:current?.text||candidate,
        status:current?.status||'PROPOSED',sourceRefs:evidence.map(m=>m.sourceRef),
        verifiedReal:false,synthetic:true};
    });
  }
  function setProfile(key,mode,content){
    if(!PROFILE_SECTIONS.some(s=>s.key===key))throw Error('PROFILE_CATEGORY_UNKNOWN');
    if(!['CONFIRMED_DEMO','REJECTED_DEMO'].includes(mode))throw Error('PROFILE_STATE_INVALID');
    const s=snapshot();
    if(!s.consent.memory)throw Error('MEMORY_CONSENT_REQUIRED');
    const p=profile().find(x=>x.key===key);
    if(mode==='CONFIRMED_DEMO'&&(!p.sourceRefs.length||p.status==='REJECTED_DEMO'))
      throw Error('PROFILE_REQUIRES_SYNTHETIC_EVIDENCE');
    aboutStates.set(key,{status:mode,text:mode==='REJECTED_DEMO'?'시연 후보 거부됨':str(content)||p.candidate});
    extraEpoch++;
    return profile();
  }
  function map(){
    const s=snapshot();
    if(!s.consent.memory)return [];
    return s.memories.filter(m=>m.status==='APPROVED').map(m=>({
      nodeId:'memory:'+m.id,sourceRef:m.sourceRef,title:m.topic,linkedTo:'device:'+m.device,
      relation:'합성 기록의 출처 기기',synthetic:true,status:'SYNTHETIC_LINK_ONLY'
    }));
  }
  return Object.freeze({snapshot,consentMemory,seed,correct:corrected,approve,revokeItem,search,sources,
    profile,setProfile,map,detectEvidenceConflicts,synthetic:true});
}
