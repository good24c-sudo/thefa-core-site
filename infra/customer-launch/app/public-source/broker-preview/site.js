'use strict';
(async()=>{
 const $=id=>document.getElementById(id),create=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
 let csrf=null,refreshing=false,requestId=null;
 const REVIEW_QA='R5_EVIDENCE_NEEDS_HUMAN_REVIEW';
 const statusText=job=>{
  const review=job.status==='WAITING_DEPENDENCY'&&job.receipt?.qa===REVIEW_QA;
  if(review)return {title:'추가 검토 필요',detail:'AI 보고서가 작성됐지만 출처와 내용은 사람의 확인이 필요합니다. 보고서·출처·검토 기록을 내려받아 확인해 주세요.',kind:'needs-review'};
  const states={
   QUEUED:['대기 중','내 PC가 작업을 받을 때까지 기다리는 중입니다.'],
   CLAIMED:['PC에 전달됨','내 PC가 작업을 수령했습니다. 아직 완료된 작업은 아닙니다.'],
   RUNNING:['실행 중','작업 처리 중입니다. 중복 제출하지 말고 진행 상태를 확인해 주세요.'],
   COMPLETED:['작업 처리 완료','결과 파일을 확인해 주세요. 실행 완료가 내용·사실 검증까지 통과했다는 뜻은 아닙니다.'],
   QA_FAILED:['검토 실패','품질 검사를 통과하지 못했습니다. 결과를 성공으로 표시하지 않습니다.'],
   FAILED:['처리 실패','작업 원인과 기존 기록을 확인해 주세요. 자동 재실행하지 않습니다.'],
   WAITING_DEPENDENCY:['추가 확인 필요','기존 작업의 의존성이나 검토가 필요합니다. 작업을 중복 실행하지 않습니다.'],
   RECONCILE_REQUIRED:['기존 작업 확인 필요','실행 결과가 불명확합니다. 원 작업 기록을 확인하기 전 재실행하지 않습니다.']
  };
  const pair=states[job.status]||['상태 확인 필요','내부 처리 상태를 확인한 뒤 다시 조회해 주세요.'];
  return {title:pair[0],detail:pair[1],kind:'normal'};
 };
 const fileText=Object.freeze({
  'report.md':'AI 결과 보고서',
  'plan.json':'작업 계획',
  'review.json':'AI 검토 기록',
  'sources.json':'참고자료·출처 기록',
  'qa_evidence.json':'품질·증거 요약'
 });
 const allowedJobId=/^webjob_[a-f0-9-]{36}$/;
 const allowedFilename=/^[A-Za-z0-9_.-]{1,100}$/;
 const endpoint=async(path,{method='GET',body}={})=>{
  const init={method,credentials:'same-origin',cache:'no-store',headers:{}};
  if(method==='POST'){init.headers={'content-type':'application/json','x-csrf-token':csrf};init.body=JSON.stringify(body??{})}
  const res=await fetch(path,init);
  const data=await res.json();if(!res.ok)throw Error(data.code??('HTTP_'+res.status));return data;
 };
 try{const boot=await endpoint('/v1/customer/bootstrap');csrf=boot.csrfToken}
 catch(err){$('devices').textContent='사이트 합성 로그인 정보를 확인할 수 없습니다: '+err.message;return}
 async function load(){
  if(refreshing)return;refreshing=true;
  try{
   const [dv,jb]=await Promise.all([endpoint('/v1/customer/devices'),endpoint('/v1/customer/jobs')]);
   const select=$('device'),current=select.value;select.replaceChildren();
   for(const d of dv.devices){const op=create('option',d.label);op.value=d.deviceId;select.appendChild(op)}
   if(current&&dv.devices.some(d=>d.deviceId===current))select.value=current;
   $('devices').textContent=dv.devices.length?dv.devices.map(x=>x.label+' / '+x.deviceId).join('\n'):'연결된 PC가 없습니다.';
   $('jobs').replaceChildren();
   if(!jb.jobs.length)$('jobs').textContent='아직 작업이 없습니다.';
   for(const j of jb.jobs){
    const display=statusText(j),item=create('article');
    item.className='customer-task '+display.kind;
    const heading=create('b',(j.type==='REPORT'?'보고서':j.type==='CODE'?'코드':j.type==='SHEET'?'엑셀':j.type==='VIDEO'?'영상':'작업')+' · '+display.title);
    heading.className='task-state';
    item.appendChild(heading);
    const info=create('p',display.detail);
    info.className='task-detail';item.appendChild(info);
    item.appendChild(create('small',j.instruction));
    if(j.receipt?.qa===REVIEW_QA){
     const note=create('p','자료 범위: 이전에 수집한 일부 공개 웹 검색 자료입니다. 최신 매장 영업·가격·매출·전체 경쟁 현황은 검증되지 않았습니다.');
     note.className='review-scope';item.appendChild(note);
    }else if(j.receipt){
     item.appendChild(create('small','결과와 품질을 따로 확인해 주세요. 결과 파일과 작업 기록을 보존합니다.'));
    }
    if(allowedJobId.test(j.id)){
     for(const f of j.artifacts??[]){
      if(!allowedFilename.test(f.name)||f.name.includes('..'))continue;
      const a=create('a',(fileText[f.name]||f.name)+' 다운로드');
      a.href='/v1/customer/jobs/'+j.id+'/files/'+encodeURIComponent(f.name);
      a.setAttribute('download',f.name);a.className='result-file';
      item.appendChild(a);
     }
    }
    $('jobs').appendChild(item);
   }
  }catch(e){$('sent').textContent='상태 조회 실패: '+e.message}
  finally{refreshing=false}
 }
 $('pair-code').addEventListener('click',async()=>{
  try{const r=await endpoint('/v1/customer/pair',{method:'POST',body:{label:'나의 로컬 PC'}});
   $('pair-value').textContent='연결 코드: '+r.pairingCode+'\n5분 내에 로컬 앱에서 사용 · 사용 후 만료';
  }catch(e){$('pair-value').textContent='코드 발급 실패: '+e.message}
 });
 $('job-form').addEventListener('submit',async ev=>{
  ev.preventDefault();
  try{
   if(!requestId)requestId='webqa_'+crypto.randomUUID().replaceAll('-','');
   const d=$('device').value;if(!d)throw Error('PC를 먼저 연결해 주세요.');
   const response=await endpoint('/v1/customer/jobs',{method:'POST',body:{
    deviceId:d,requestId,instruction:$('instruction').value,type:$('job-type').value,explicitUserAction:true}});
   $('sent').textContent=response.reused?'이미 접수된 동일 요청입니다.':'로컬 PC에 요청을 접수했습니다. 진행 결과를 조회하세요.';
   if(!response.reused)requestId=null;
   await load();
  }catch(e){$('sent').textContent='접수 실패: '+e.message}
 });
 $('refresh').addEventListener('click',load);
 await load();
 setInterval(load,4500);
})();
