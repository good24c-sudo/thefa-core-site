import {createDemoAva,DEMO_CONTRACT} from '/ava-world-engine.mjs';
/** Existing THE FA Core UI extension. Explicitly synthetic-only; NEVER calls auth, memory API or cloud. */
const ava=createDemoAva();
const $=id=>document.getElementById(id);
const note=(id,text)=>{const e=$(id);if(e)e.textContent=text};
const noteStyle=(id,type)=>{const e=$(id);if(e)e.dataset.state=type};
const safeLabel=text=>document.createTextNode(String(text));
function renderMemories(s){
 const parent=$('ava-demo-memories');
 if(!parent)return;
 parent.replaceChildren();
 if(!s.memories.length){
  const p=document.createElement('p');p.className='muted';
  p.textContent=s.consent.memory?'합성 기억이 없습니다. 샘플을 불러오세요.':'기억 사용을 켜지 않았습니다.';
  parent.appendChild(p);return;
 }
 for(const m of s.memories){
  const card=document.createElement('div');card.className='ava-memory-card';
  const head=document.createElement('div');head.className='ava-memory-card-head';
  const title=document.createElement('strong');title.textContent=m.device==='PHONE'?'휴대폰 기록':'컴퓨터 기록';
  const chip=document.createElement('span');chip.className='ava-memory-status';chip.dataset.state=m.status;chip.textContent=m.statusLabel;
  head.append(title,chip);
  const text=document.createElement('p');text.textContent=m.text;
  const meta=document.createElement('small');meta.textContent='출처: '+m.source+' · 기록일: '+m.date+' · 버전 '+m.revision+' · 모두 합성 예시';
  const footer=document.createElement('div');footer.className='ava-memory-footer';
  const button=document.createElement('button');button.type='button';button.className='button';
  if(m.status==='APPROVED'){
   button.textContent='정정 시연';button.addEventListener('click',()=>{
    try{
     const replacement=m.device==='PHONE'
       ?'정정된 합성 기록: 매장 조사는 표본 크기뿐 아니라 조사 기간도 확인한다.'
       :'정정된 합성 기록: 기존 자산을 검토하고 안전한 검증 단계를 먼저 거친다.';
     ava.correct(m.id,replacement);note('ava-demo-answer','기억을 정정했습니다. 이전 답변의 승인은 무효화됐으며 재승인을 해야 사용할 수 있습니다.');refresh('MEMORY_PENDING');
    }catch(err){note('ava-demo-answer',err.message)}
   });
  }else{
   button.textContent='다시 승인';button.addEventListener('click',()=>{
    try{ava.approve(m.id);note('ava-demo-answer','정정된 합성 기억을 다시 승인했습니다. 이전 버전과 구분해 검색합니다.');refresh('MEMORY_APPROVED');}catch(err){note('ava-demo-answer',err.message)}
   });
  }
  footer.append(button);card.append(head,text,meta,footer);parent.appendChild(card);
 }
}
function refresh(event='REFRESH'){
 const s=ava.snapshot();
 const memory=$('ava-demo-consent'),entry=$('ava-world-entry-consent'),share=$('ava-world-share-consent');
 if(memory)memory.checked=s.consent.memory;
 if(entry){entry.checked=s.consent.world;entry.disabled=!s.consent.memory}
 if(share){share.checked=s.consent.share;share.disabled=!s.consent.world}
 if($('ava-demo-seed'))$('ava-demo-seed').disabled=!s.consent.memory||s.memories.length>0;
 if($('ava-demo-ask'))$('ava-demo-ask').disabled=!s.consent.memory||s.memories.every(m=>m.status!=='APPROVED');
 note('ava-demo-count',s.memories.filter(m=>m.status==='APPROVED').length+'개 승인 기억 · 합성 시연');
 note('ava-demo-epoch','기억 상태 버전 '+s.epoch);
 renderMemories(s);
 document.documentElement.dataset.avaPreviewContract=DEMO_CONTRACT;
 document.documentElement.dataset.avaPreviewEvent=event;
}
function bind(){
 if(!$('ava-lab')||!$('world-panel'))return;
 $('ava-demo-consent').addEventListener('change',e=>{
  try{ava.consent('memory',e.target.checked);note('ava-demo-answer',e.target.checked?'합성 기억 사용을 켰습니다. 아직 실제 기억은 수집하지 않습니다.':'합성 기억 사용을 중지했습니다. 이 브라우저의 시연 기억이 초기화됐습니다.');refresh('MEMORY_CONSENT_CHANGED')}
  catch(err){note('ava-demo-answer',err.message);refresh('DENIED')}
 });
 $('ava-demo-seed').addEventListener('click',()=>{
  try{ava.seed();note('ava-demo-answer','합성 기록 3개를 불러왔습니다. 기억 출처와 날짜를 확인해 주세요.');refresh('SYNTHETIC_SEEDED')}
  catch(err){note('ava-demo-answer',err.message)}
 });
 $('ava-demo-revoke').addEventListener('click',()=>{
  try{ava.consent('memory',false);note('ava-demo-answer','기억 사용이 중지되고 합성 기록이 초기화됐습니다. 실제 서버 데이터 삭제를 의미하지 않습니다.');refresh('MEMORY_REVOKED')}
  catch(err){note('ava-demo-answer',err.message)}
 });
 $('ava-demo-question-form').addEventListener('submit',e=>{
  e.preventDefault();
  const q=$('ava-demo-question').value.trim(),device=$('ava-demo-device').value;
  const a=ava.answer(q,{device});
  if(a.status==='GROUNDED'){
    note('ava-demo-answer',a.text+'\n'+a.source+' · '+a.sourceDate+' · '+a.device+' · 합성 기록 근거\n'+a.explanation);
    noteStyle('ava-demo-answer','GROUNDED');
  }else{
    note('ava-demo-answer',a.status==='NO_GROUNDED_ANSWER'?'승인된 기록에서 해당 답변을 확인할 수 없습니다. 다른 질문을 해보세요.':'아직 기억을 사용할 수 없습니다. 먼저 동의를 확인해 주세요.');
    noteStyle('ava-demo-answer',a.status);
  }
 });
 $('ava-world-entry-consent').addEventListener('change',e=>{
  try{ava.consent('world',e.target.checked);note('ava-world-guard-result',e.target.checked?'합성 World 입장 동의를 선택했습니다. 실제 월드 입장 권한은 부여되지 않습니다.':'합성 월드 입장 동의를 철회했습니다. 지식 공개 동의도 초기화됩니다.');refresh('WORLD_CONSENT_CHANGED')}
  catch{note('ava-world-guard-result','기억 사용 동의를 먼저 선택해 주세요.');refresh('WORLD_DENIED')}
 });
 $('ava-world-share-consent').addEventListener('change',e=>{
  try{ava.consent('share',e.target.checked);note('ava-world-guard-result',e.target.checked?'지식 공개 동의가 선택됐지만 실제 지식을 게시하지 않습니다.':'지식 공개 동의를 취소했습니다.');refresh('SHARE_CONSENT_CHANGED')}
  catch{note('ava-world-guard-result','World 입장 동의가 필요합니다.');refresh('SHARE_DENIED')}
 });
 $('ava-world-enter').addEventListener('click',()=>{
  const value=ava.enterWorld();
  note('ava-world-guard-result',value.status==='SYNTHETIC_WORLD_PREVIEW_ALLOWED'?'개인 공간 체험 가능(합성 시연). 실제 로그인·멀티사용자 World와는 연결되지 않습니다.':'아직 입장 체험 조건이 부족합니다. 나의 AVA에서 기억 동의·승인을 확인하고 World 입장 동의를 켜 주세요.');
  noteStyle('ava-world-guard-result',value.status);
 });
 $('ava-world-publish').addEventListener('click',()=>{
  const result=ava.requestPublication();
  note('ava-world-guard-result','공개를 실행하지 않았습니다. 검증된 출처·라이선스·별도 게시 승인이 없으므로 공개 기능은 차단됩니다. ('+result.status+')');
  noteStyle('ava-world-guard-result',result.status);
 });
 // Verify static resources. A 404 must not be shown as a functional city preview.
 Promise.all([
  fetch('/world-original-v2.html',{method:'HEAD',cache:'no-store'}).then(r=>r.ok).catch(()=>false),
  fetch('/assets/world-tour.mp4',{method:'HEAD',cache:'no-store'}).then(r=>r.ok).catch(()=>false),
  fetch('/assets/world-city-original.png',{method:'HEAD',cache:'no-store'}).then(r=>r.ok).catch(()=>false)
 ]).then(([world,tour,city])=>{
   if(world)$('ava-world-original-link').hidden=false;
   if(tour)$('ava-world-tour-link').hidden=false;
   if(city){const el=document.querySelector('.ava-world-city-stage');if(el)el.style.backgroundImage='url("/assets/world-city-original.png")';}
   note('ava-world-asset-status',world||city?'기존 World V2 자산에서 가져온 미리보기입니다. 실제 이용 서비스는 아닙니다.':'World V2 원본 자료는 검증 패키지에 보존됐습니다. 이 화면의 도시 체험 연결은 준비 중입니다.');
 }).catch(()=>note('ava-world-asset-status','도시 자료 연결을 확인하지 못했습니다.'));
 refresh('INIT');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
