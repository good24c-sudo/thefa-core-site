import {docxFile,xlsxFile,saveBlob} from '/customer-toolkit-files.mjs';
import {saveAiPresentation} from '/paid-presentation.mjs';
const $=id=>document.getElementById(id);
let csrf='',active=null,lastText='',checkCount=0,checking=false;
const msg=(state,text)=>{$('job-status').textContent=state;$('service-state').textContent=text;};
const errMap={
 QA_SESSION_REQUIRED:'시험 계정 연결이 끊어졌습니다. 페이지를 새로 열어 주세요.',
 SAME_ORIGIN_CSRF_REQUIRED:'요청 보호 검증이 실패했습니다. 새로고침해 주세요.',
 LOCAL_RESOURCE_BUSY:'다른 작업이 처리 중입니다. 기존 작업이 완료된 뒤 실행해 주세요.',
 IDEMPOTENCY_KEY_CONFLICT:'동일 요청 ID에 다른 내용이 있습니다. 이전 작업을 확인해 주세요.',
 OLLAMA_HTTP_503:'로컬 AI 실행기의 상태를 확인해 주세요.'
};
async function jsonApi(url,opt={}){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...opt});
 let j;try{j=await r.json();}catch{throw Error('NETWORK_JSON_INVALID');}
 if(!r.ok)throw Error(errMap[j.code]||j.code||'REQUEST_FAILED');
 return j;
}
async function init(){
 try{
  const j=await jsonApi('/api/qa/bootstrap');
  csrf=j.csrf;
  const h=await jsonApi('/api/qa/health');
  msg('준비됨',h.status==='ISOLATED_FUNCTIONAL_TEST_READY'?'로컬 AI 기반 업무 제작을 사용할 수 있습니다. 실제 이용권은 시험 전용입니다.':'실행 상태를 확인해 주세요.');
  await loadJobs();
  await recoverPending();
 }catch(e){msg('연결 실패',e.message);}
}
const REQUEST_KEY='thefa_r5_qa_pending_work';
const pending=()=>{
 try{return JSON.parse(sessionStorage.getItem(REQUEST_KEY)||'null')}catch{return null}
};
function renderWorkflow(job){
 const area=$('workflow-timeline'),quality=$('quality-notice');
 area.replaceChildren();
 const history=Array.isArray(job.workflowStages)?job.workflowStages:[];
 if(!['WORKFLOW','RESEARCH','BUSINESS_EVIDENCE'].includes(job.mode)){area.hidden=true;quality.hidden=true;return;}
 area.hidden=false;
 const labels={PLAN:'작업 계획',RESEARCH:job.mode==='BUSINESS_EVIDENCE'?'연결된 검색 증거 확인':'공개 학술자료 실제 검색',DRAFT:'초안 작성',REVIEW:'AI 검토',REVISE:'수정 반영',FINAL:'완료 점검'};
 const latest=history.reduce((acc,entry)=>{acc[entry.key]=entry;return acc},{});
 const order=['RESEARCH','BUSINESS_EVIDENCE'].includes(job.mode)?['PLAN','RESEARCH','DRAFT','REVIEW','REVISE','FINAL']:['PLAN','DRAFT','REVIEW','REVISE','FINAL'];
 for(const key of order){
  if(key==='REVISE'&&!history.some(x=>x.key==='REVISE'))continue;
  const li=document.createElement('li');
  const stage=latest[key];
  const label=labels[key];
  li.className=stage?.status==='COMPLETED'?'completed':stage?.status==='RUNNING'?'running':'pending';
  li.textContent=label+' · '+(stage?.status==='COMPLETED'?'완료':stage?.status==='RUNNING'?'진행 중':'대기');
  area.appendChild(li);
 }
 quality.hidden=false;
 quality.dataset.state=job.qualityStatus==='PASS'?'pass':'review';
 quality.textContent=job.state==='SUCCEEDED'
  ?(job.mode==='RESEARCH'?'공개 학술 서지정보 실제 조회와 AI 자체 검토 완료 · 논문 본문·실증 결과는 확인하지 않았습니다.':'AI 자체 검토 통과 · 외부 사실 검증은 수행하지 않았습니다.')
  :job.state==='NEEDS_REVIEW'
   ? (job.mode==='BUSINESS_EVIDENCE'?'공개 검색 스니펫을 활용한 검토용 보고서입니다. 매장의 최신 영업·가격·매출을 직접 확인하지 않았습니다.':'추가 사람 검토가 필요한 초안입니다. 외부 게시·실제 제출 전 확인이 필요합니다.')
   :job.state==='FAILED'||job.state==='RECONCILE_REQUIRED'
    ?'실행 상태 확인이 필요합니다. 원 작업을 자동 재실행하지 않습니다.'
    :'현재 단계: '+(labels[job.workflowStage]||'작업 접수')+' · 실제 AI 실행 중';
}
async function recoverPending(){
 const record=pending();
 if(!record||typeof record.requestId!=='string')return;
 try{
  const v=await jsonApi('/api/qa/requests/'+encodeURIComponent(record.requestId));
  if(v.job?.id){
   await showJob(v.job.id);
   if(!['ACCEPTED','RUNNING'].includes(v.job.state))sessionStorage.removeItem(REQUEST_KEY);
   else msg('원 작업 확인','이전에 접수된 작업을 조회했습니다. 중복 생성 없이 계속 상태를 확인해 주세요.');
  }
 }catch(e){
  msg('이전 요청 확인 필요','이전 접수 상태를 확인하지 못했습니다. 새 작업을 임의 재생성하지 않습니다. '+e.message);
 }
}
function updateResearchMode(){
 const mode=$('task-mode').value,academic=mode==='RESEARCH',business=mode==='BUSINESS_EVIDENCE';
 $('research-query-group').hidden=!academic;$('research-query').required=academic;
 $('business-context-group').hidden=!business;$('business-dataset').required=business;
}
function renderSources(evidence){
 const box=$('research-sources'),list=$('research-source-list');
 list.replaceChildren();
 const isBiz=evidence?.contract==='THEFA_CUSTOMER_R5_BUSINESS_EVIDENCE_SNAPSHOT_V1';
 const isAcademic=evidence?.contract==='THEFA_CUSTOMER_R4_REAL_PUBLIC_EVIDENCE_METADATA_V1';
 if(!isBiz&&!isAcademic){box.hidden=true;return;}
 const sources=Array.isArray(evidence?.sources)?evidence.sources:[];
 $('source-list-title').textContent=isBiz?'사업체 공개 검색 출처 (스니펫)':'실조회 학술자료';
 $('source-list-notice').textContent=isBiz?
  '개발 QA용으로 이전에 검색한 제3자 스니펫입니다. 매장 운영 여부·정확한 위치·매출·경쟁사 전체 데이터는 확인되지 않았습니다.':
  '학술 서지정보만 실조회했으며 논문 본문과 연구 결과를 확인하지 않았습니다.';
 for(const x of sources.slice(0,6)){
  const id=String(x.sourceId||''),title=String(x.title||''),raw=String(x.url||'');
  if(!/^[BS][1-6]$/.test(id)||!title||raw.length>500)continue;
  let url;try{url=new URL(raw)}catch{continue}
  if(url.protocol!=='https:')continue;
  if(isBiz&&!['tabling.co.kr','berryhappy.tistory.com','blog.naver.com'].includes(url.hostname))continue;
  if(isAcademic&&!['doi.org','openalex.org'].includes(url.hostname))continue;
  const li=document.createElement('li'),a=document.createElement('a');
  a.textContent='['+id+'] '+title;a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';
  const small=document.createElement('small');
  small.textContent=' · '+(isBiz?'발행일 미확인 · 제3자 검색 스니펫':(x.publicationDate||'발행일 확인 필요')+' · '+(x.journal||x.provider||'서지 메타데이터'));
  li.append(a,small);list.append(li);
 }
 box.hidden=!list.children.length;
}
function updateButtons(ready){
 $('download-docx').disabled=!ready;
 $('download-xlsx').disabled=!ready;
 $('download-pptx').disabled=!ready;
 $('download-md').hidden=!ready;
}
async function loadJobs(){
 try{
  const j=await jsonApi('/api/qa/jobs');
  $('job-list').replaceChildren();
  const a=[...j.jobs].reverse();
  if(!a.length){const li=document.createElement('li');li.textContent='아직 저장된 시험 작업이 없습니다.';$('job-list').append(li);return;}
  for(const job of a){
   const li=document.createElement('li'),button=document.createElement('button');
   button.type='button';button.textContent='확인';button.addEventListener('click',()=>showJob(job.id));
   li.textContent=job.mode+' · '+job.state+' · '+job.createdAt.slice(0,19).replace('T',' ');
   li.append(button);$('job-list').append(li);
  }
 }catch(e){msg('목록 오류',e.message);}
}
async function showJob(id){
 try{
  const {job}=await jsonApi('/api/qa/jobs/'+id);
  active=job;updateButtons(false);renderWorkflow(job);
  $('download-plan').hidden=true;$('download-review').hidden=true;$('download-sources').hidden=true;
  $('research-sources').hidden=true;$('research-source-list').replaceChildren();
  $('refresh-job').disabled=false;
  msg(job.state,'작업 ID '+job.id+' · 원 요청을 임의로 다시 실행하지 않습니다.');
  if(['SUCCEEDED','NEEDS_REVIEW'].includes(job.state)){ 
   const r=await fetch(job.artifact,{credentials:'same-origin',cache:'no-store'});
   if(!r.ok)throw Error('ARTIFACT_UNAVAILABLE');
   const t=await r.text();
   if(!t||t.length<50)throw Error('EMPTY_RESULT');
   lastText=t;
   $('result-content').textContent=t;
   $('download-md').href=job.artifact;
   updateButtons(true);
   if(job.planArtifact){$('download-plan').href=job.planArtifact;$('download-plan').hidden=false;}
   if(job.reviewArtifact){$('download-review').href=job.reviewArtifact;$('download-review').hidden=false;}
   if(job.sourceArtifact){
    $('download-sources').href=job.sourceArtifact;$('download-sources').hidden=false;
    try{const evidence=await jsonApi(job.sourceArtifact);renderSources(evidence);}catch(e){msg('출처 확인 실패',e.message+' · 내려받기 전에 원본을 검증해 주세요.');}
   }
   if(pending()?.requestId){try{const check=await jsonApi('/api/qa/requests/'+encodeURIComponent(pending().requestId));if(check.job?.id===job.id)sessionStorage.removeItem(REQUEST_KEY);}catch{}}
  }else{
   lastText='';
   if(job.state==='FAILED'&&pending()?.requestId){
    try{const check=await jsonApi('/api/qa/requests/'+encodeURIComponent(pending().requestId));
      if(check.job?.id===job.id)sessionStorage.removeItem(REQUEST_KEY);}catch{}
   }
   $('result-content').textContent=job.state==='RECONCILE_REQUIRED'?'원 작업 결과가 불분명합니다. 재실행하지 않고 기존 기록을 확인해야 합니다.':
   job.state==='FAILED'?'작업이 완료되지 않았습니다. 코드: '+job.errorCode:
   '작업이 접수되어 실행 중입니다. 화면을 닫아도 작업 상태는 서버에 남습니다.';
  }
  return job;
 }catch(e){msg('조회 실패',e.message);return null;}
}
async function boundedCheck(id){
 if(checking)return;checking=true;checkCount=0;
 try{
  while(checkCount++<100){
   await new Promise(resolve=>setTimeout(resolve,1600));
   const j=await showJob(id);
   if(!j || !['ACCEPTED','RUNNING'].includes(j.state))break;
  }
  if(checkCount>=100)msg('작업 진행 중일 수 있음','기존 작업 ID를 보존했습니다. 진행 상태는 결과 다시 확인에서 조회할 수 있습니다.');
 }finally{checking=false;$('run').disabled=false;await loadJobs();}
}
$('work-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!csrf)return;
 const body={mode:$('task-mode').value,prompt:$('task-prompt').value.trim(),requestId:crypto.randomUUID()};
 if(body.mode==='RESEARCH')body.researchQuery=$('research-query').value.trim();
 if(body.mode==='BUSINESS_EVIDENCE')body.businessDataset=$('business-dataset').value;
 if(body.prompt.length<8){msg('입력 확인','어떤 일을 처리할지 자세히 적어 주세요.');return;}
 $('run').disabled=true;updateButtons(false);lastText='';$('result-content').textContent='이전 요청과 중복 여부를 확인하고 있습니다…';
 try{
  const prev=pending();
  if(prev){
   if(prev.prompt!==body.prompt||prev.mode!==body.mode||(prev.researchQuery||null)!==(body.researchQuery||null)||(prev.businessDataset||null)!==(body.businessDataset||null)){
    msg('원 작업 보호','이전에 접수된 명령의 상태가 확인되지 않았습니다. 기존 명령과 작업 기록을 먼저 확인하세요.');
    $('run').disabled=false;return;
   }
   body.requestId=prev.requestId;
   try{
    const prior=await jsonApi('/api/qa/requests/'+encodeURIComponent(body.requestId));
    if(prior.job?.id){
     await showJob(prior.job.id);
     if(['RUNNING','ACCEPTED'].includes(prior.job.state))await boundedCheck(prior.job.id);
     else $('run').disabled=false;
     return;
    }
   }catch(e){if(e.message!=='QA_REQUEST_NOT_FOUND')throw e;}
  }else{
   sessionStorage.setItem(REQUEST_KEY,JSON.stringify({...body,queuedAt:new Date().toISOString()}));
  }
  $('result-content').textContent='요청을 안전하게 접수하고 있습니다…';
  const {job}=await jsonApi('/api/qa/jobs',{method:'POST',
   headers:{'Content-Type':'application/json','X-QA-CSRF':csrf},body:JSON.stringify(body)});
  active=job;await showJob(job.id);
  if(['RUNNING','ACCEPTED'].includes(job.state))await boundedCheck(job.id);
  else $('run').disabled=false;
 }catch(e){
  msg('요청 상태 미확인',e.message+' · 원 요청 ID를 보존했습니다. 다시 시작하기 전에 기존 요청부터 조회합니다.');
  $('result-content').textContent=e.message;$('run').disabled=false;
 }
});
document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{
 $('task-mode').value=b.dataset.example;$('task-prompt').value=b.dataset.prompt;
 if(b.dataset.research)$('research-query').value=b.dataset.research;
 updateResearchMode();$('task-prompt').focus();
}));
$('task-file').addEventListener('change',async()=>{
 const f=$('task-file').files?.[0];if(!f)return;
 if(f.size>16384||!/\.(txt|md|csv)$/i.test(f.name)){
  msg('파일 확인 필요','TXT·MD·CSV 자료 중 16KB 이하 파일만 가능합니다.');
  $('task-file').value='';return;
 }
 try{
  const old=$('task-prompt').value.trim(),intro=(old?old+'\n\n':'')+'[고객 제공 파일 내용]\n';
  const limit=3500-intro.length;
  if(limit<150)throw Error('입력 내용이 너무 깁니다.');
  const content=await f.text();
  $('task-mode').value='DATA';updateResearchMode();
  $('task-prompt').value=intro+content.slice(0,limit);
  msg('파일 읽기 성공','파일을 서버에 별도 업로드하지 않고 요청문에 포함했습니다. 이 시험판은 실제 고객 개인정보를 입력하지 마세요.');
 }catch(e){msg('파일 읽기 실패',e.message)}
});
$('refresh-list').addEventListener('click',loadJobs);
$('refresh-job').addEventListener('click',()=>active&&showJob(active.id));
$('download-docx').addEventListener('click',async()=>{
 if(!lastText)return;
 try{
  const parts=lastText.split(/\n{2,}/).slice(0,28);
  const sections=parts.map((x,i)=>['항목 '+(i+1),x.slice(0,2200)]);
  saveBlob('THEFA_Core_업무결과.docx',await docxFile('THE FA Core 실제 AI 업무 결과',sections));
 }catch(e){msg('파일 생성 실패',e.message);}
});
$('download-xlsx').addEventListener('click',async()=>{
 if(!lastText)return;
 try{
  const lines=lastText.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,250);
  const rows=[['번호','내용'],...lines.map((x,i)=>[String(i+1),x.slice(0,2200)])];
  saveBlob('THEFA_Core_업무요약.xlsx',await xlsxFile(rows,{sheetName:'AI 결과 요약'}));
 }catch(e){msg('엑셀 생성 실패',e.message);}
});
$('download-pptx').addEventListener('click',async()=>{
 if(!lastText)return;
 const button=$('download-pptx');button.disabled=true;
 try{const info=await saveAiPresentation(lastText);msg('발표자료 생성 요청 완료',info.slides+'장의 편집 가능한 PPTX를 다운로드 목록에서 확인하세요.');}
 catch(e){msg('발표자료 생성 실패',e.message);}
 finally{button.disabled=false;}
});
$('task-mode').addEventListener('change',updateResearchMode);
updateResearchMode();
init();