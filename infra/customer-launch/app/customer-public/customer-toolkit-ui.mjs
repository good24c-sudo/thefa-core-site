import {TOOLKIT_CONTRACT,MODES,READINESS_CATEGORIES,detectIntent,makeWorkBrief,buildFunnel,buildContentCalendar,buildBusinessPlan,assessReadiness,parseCsv,toCsv,analyzeImportedTable,toMarkdown} from '/customer-toolkit-engine.mjs';
import {docxFile,xlsxFile,saveBlob} from '/customer-toolkit-files.mjs';
const $=id=>document.getElementById(id);
const LABELS={BRIEF:'명령 정리',FUNNEL:'고객·마케팅',CONTENT:'SNS 콘텐츠',BUSINESS:'사업계획서',READINESS:'준비 체크',TABLE:'내 표 정리'};
const FIELD_SPECS={
 BRIEF:[['goal','어떤 일을 맡기시겠어요?','textarea','예: 우리 카페 홍보 계획과 검증 가능한 결과물을 만들어줘'],['audience','누구를 위한 작업인가요?','text','예: 첫 방문 고객'],['output','원하는 결과물','text','예: 보고서·표·발표자료'],['constraints','지켜야 할 조건','text','예: 가격과 매출은 추측하지 않기']],
 FUNNEL:[['business','사업·매장 이름','text','예: 우리 동네 카페'],['offer','제품·서비스','text','예: 수제 디저트와 커피'],['audience','핵심 고객','text','예: 주말 방문 고객'],['channels','현재 활용 채널','text','예: 인스타그램, 네이버'],['goal','측정할 목표','text','예: 예약과 실제 재방문']],
 CONTENT:[['brand','브랜드·매장 이름','text','예: 우리 동네 카페'],['product','소개할 제품·서비스','text','예: 가을 디저트'],['audience','주요 고객','text','예: 20~40대 지역 고객'],['channel','게시 채널','select',['Instagram','Threads','블로그','매장 안내']]],
 BUSINESS:[['business','기업·사업명','text','예: 우리 회사'],['service','주요 사업과 제공 가치','textarea','예: 매장 고객의 재방문을 측정하는 서비스'],['customer','주요 고객','text','예: 지역 소상공인'],['amount','검토 중인 자금 규모(선택)','text','실제 근거 있는 금액만'],['use','자금 사용처(선택)','textarea','예: 장비 도입과 운영자금'],['revenueProof','매출·상환 근거(선택)','textarea','확인된 자료만 입력해 주세요']],
 TABLE:[['csvText','직접 준비한 표(CSV) 붙여넣기','textarea','예: 상호명,업종,검토사항\\n카페A,카페,웹사이트 확인\\n카페B,카페,현장 조사']],
};
let mode='BRIEF',current=null,downloadBusy=false;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
const errorText=e=>({
  REQUIRED_GOAL:'명령을 입력해 주세요.',REQUIRED_BUSINESS:'사업·매장 이름을 입력해 주세요.',
  REQUIRED_OFFER:'제품이나 서비스를 적어 주세요.',REQUIRED_AUDIENCE:'고객을 적어 주세요.',
  REQUIRED_BRAND:'브랜드 이름을 적어 주세요.',REQUIRED_PRODUCT:'제품·서비스를 적어 주세요.',
  REQUIRED_SERVICE:'사업 설명을 입력해 주세요.',REQUIRED_CUSTOMER:'고객을 적어 주세요.',
  CSV_ROWS_REQUIRED:'표의 제목 행과 데이터 행을 넣어 주세요.',CSV_UNEVEN_COLUMNS:'각 행의 열 개수를 맞춰 주세요.',
  CSV_TOO_LARGE:'표가 너무 큽니다. 600행 이내로 줄여 주세요.',CSV_UNCLOSED_QUOTE:'표 안의 따옴표를 확인해 주세요.',
  INPUT_TOO_LONG:'입력한 내용이 너무 깁니다. 내용을 줄여 주세요.'
})[e?.message]||'입력 내용을 확인하고 다시 시도해 주세요.';
function updateStatus(text,state='note'){
 const el=$('toolkit-status');if(!el)return;el.textContent=text;el.dataset.state=state;
}
function activeMode(next){
 if(!MODES.includes(next))return;
 mode=next;current=null;
 document.querySelectorAll('[data-toolkit-mode]').forEach(b=>{
  const selected=b.dataset.toolkitMode===mode;b.classList.toggle('selected',selected);
  b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;
 });
 $('toolkit-mode-label').textContent=LABELS[mode];
 $('toolkit-result').replaceChildren(node('p','toolkit-muted','내용을 입력해 결과물을 만들어 보세요.'));
 $('toolkit-result-actions').hidden=true;
 renderFields();updateStatus('입력한 내용은 이 브라우저에서만 처리되며 자동 저장되지 않습니다.');
}
function field(name,label,kind,hint){
 const div=node('div','toolkit-field');
 const id='toolkit-field-'+name;
 const lab=node('label','toolkit-label',label);lab.htmlFor=id;div.append(lab);
 let el;
 if(kind==='textarea'){el=node('textarea','toolkit-input');el.rows=name==='goal'?4:3;el.maxLength=name==='csvText'?120000:1200;}
 else if(kind==='select'){
  el=node('select','toolkit-input');
  for(const option of hint){const o=node('option','',option);o.value=option;el.append(o)}
 }else{el=node('input','toolkit-input');el.type='text';el.maxLength=380;}
 el.id=id;el.name=name;
 if(typeof hint==='string')el.placeholder=hint.replace(/\\n/g,'\n');
 if(['goal','business','offer','audience','brand','product','service','customer'].includes(name))el.required=true;
 div.append(el);return div;
}
function renderFields(){
 const form=$('toolkit-form'),fields=$('toolkit-input-fields');fields.replaceChildren();
 form.querySelectorAll('.toolkit-extra-help').forEach(el=>el.remove());
 const specs=FIELD_SPECS[mode];
 if(specs){for(const spec of specs)fields.append(field(...spec));}
 if(mode==='READINESS'){
  const chooser=field('category','확인할 준비사항','select',['사업 기본정보','서류 일치 여부','3주 준비 일정']);
  const el=chooser.querySelector('select');el.id='toolkit-category';el.name='category';chooser.querySelector('label').htmlFor='toolkit-category';
  fields.append(chooser);const checklist=node('div','toolkit-checklist');checklist.id='toolkit-checklist';
  fields.append(checklist);el.addEventListener('change',renderReadiness);renderReadiness();
 }else if(mode==='TABLE'){
  const help=node('p','toolkit-extra-help','외부 지도·검색 자료를 무단 수집하지 않습니다. 고객이 권한 있게 준비한 CSV만 정리하며 인터넷 전송·서버 저장은 하지 않습니다.');
  form.append(help);
  const upload=field('csvFile','CSV 파일 선택 (선택)','text','');
  const dummy=upload.querySelector('input');const real=node('input','toolkit-input');real.type='file';real.accept='.csv,text/csv';real.id='toolkit-file';real.name='csvFile';
  dummy.replaceWith(real);upload.querySelector('label').htmlFor='toolkit-file';fields.append(upload);
  real.addEventListener('change',async()=>{
   const file=real.files?.[0];if(!file)return;if(file.size>120000){updateStatus('파일은 120KB 이하만 지원합니다.','error');return;}
   try{const s=await file.text();$('toolkit-field-csvText').value=s;updateStatus('선택한 파일을 브라우저에서 읽었습니다. 아직 업로드하지 않았습니다.');}
   catch{updateStatus('파일을 읽지 못했습니다.','error')}
  });
 }
}
function renderReadiness(){
 const box=$('toolkit-checklist');if(!box)return;box.replaceChildren();
 const code=['profile','evidence','schedule'][$('toolkit-category').selectedIndex]??'profile';
 const items=READINESS_CATEGORIES[code];
 for(let i=0;i<items.length;i++){
  const row=node('div','toolkit-checklist-row'),lab=node('label','toolkit-label',items[i]);
  lab.htmlFor='toolkit-answer-'+i;
  const sel=node('select','toolkit-input toolkit-score');
  sel.name='check-'+i;sel.id='toolkit-answer-'+i;
  for(const [n,t] of [[0,'미준비'],[1,'추가 확인 필요'],[2,'확인됨']]){
   const opt=node('option','',t);opt.value=String(n);sel.append(opt);
  }
  row.append(lab,sel);box.append(row);
 }
}
function collect(){
 const form=$('toolkit-form'),get=n=>form.elements.namedItem(n)?.value??'';
 if(mode==='BRIEF')return makeWorkBrief({goal:get('goal'),audience:get('audience'),output:get('output'),constraints:get('constraints')});
 if(mode==='FUNNEL')return buildFunnel({business:get('business'),offer:get('offer'),audience:get('audience'),channels:get('channels'),goal:get('goal')});
 if(mode==='CONTENT')return buildContentCalendar({brand:get('brand'),product:get('product'),audience:get('audience'),channel:get('channel')});
 if(mode==='BUSINESS')return buildBusinessPlan({business:get('business'),service:get('service'),customer:get('customer'),amount:get('amount'),use:get('use'),revenueProof:get('revenueProof')});
 if(mode==='READINESS'){
  const category=['profile','evidence','schedule'][$('toolkit-category').selectedIndex]??'profile';
  return assessReadiness(category,READINESS_CATEGORIES[category].map((_,i)=>Number(get('check-'+i))));
 }
 if(mode==='TABLE')return analyzeImportedTable(parseCsv(get('csvText')));
 throw Error('UNKNOWN_MODE');
}
function display(result){
 const area=$('toolkit-result');area.replaceChildren();
 area.append(node('h3','toolkit-result-title',result.title??'내 자료 분석'));
 if(result.rows&&result.mode!=='BRIEF'){
  let head,rows;
  if(mode==='CONTENT'){head=['회차','채널','형식','주제','실제 콘텐츠 구성'];rows=result.rows.map(r=>[r.cycle,r.channel,r.format,r.topic,r.hook]);}
  else if(mode==='READINESS'){head=['항목','점수','상태'];rows=result.rows.map(r=>[r.item,String(r.score),r.status]);}
  else {head=result.headers;rows=result.rows;}
  const wrap=node('div','toolkit-table-wrap'),table=node('table','toolkit-table'),thead=node('thead'),tr=node('tr');
  for(const col of head)tr.append(node('th','',col));
  thead.append(tr);table.append(thead);
  const tbody=node('tbody');
  for(const row of rows.slice(0,120)){const line=node('tr');for(const val of row)line.append(node('td','',val));tbody.append(line);}
  table.append(tbody);wrap.append(table);area.append(wrap);
  if(mode==='READINESS')area.append(node('p','toolkit-result-sub',result.points+' / '+result.maxPoints+'점 · 공식 심사 점수나 승인 가능성이 아닙니다.'));
  if(mode==='TABLE')area.append(node('p','toolkit-result-sub','입력 파일 '+result.totalRows+'개 행의 내용을 확인했습니다. 다른 사이트와 대조하지 않았습니다.'));
 }else if(result.stages){
  for(const p of result.stages){
   const item=node('div','toolkit-result-item');item.append(node('strong','',p.name),node('p','',p.actions),node('small','',p.proof));area.append(item);
  }
 }else if(result.sections){
  for(const [key,value] of result.sections){
   const item=node('div','toolkit-result-item');item.append(node('strong','',key),node('p','',value));area.append(item);
  }
 }else{
  const item=node('div','toolkit-result-item');
  item.append(node('strong','','실행 단계'),...result.checklist.map((x,i)=>node('p','',(i+1)+'. '+x)));
  area.append(item);
 }
 if(result.caution)area.append(node('p','toolkit-caution',result.caution));
 if(result.caveat)area.append(node('p','toolkit-caution',result.caveat));
 $('toolkit-result-actions').hidden=false;
 $('toolkit-download-docx').hidden=!(mode==='BRIEF'||mode==='FUNNEL'||mode==='BUSINESS');
 $('toolkit-download-xlsx').hidden=!(mode==='CONTENT'||mode==='READINESS'||mode==='TABLE');
 $('toolkit-download-csv').hidden=!(mode==='CONTENT'||mode==='READINESS'||mode==='TABLE');
 $('toolkit-download-markdown').hidden=!(mode==='BRIEF'||mode==='FUNNEL'||mode==='BUSINESS');
}
function rowsForExport(){
 if(mode==='CONTENT')return [['회차','채널','형식','주제','제품','첫 문장 초안','행동 요청','검토'],...current.rows.map(v=>[v.cycle,v.channel,v.format,v.topic,v.subject,v.hook,v.cta,v.approval])];
 if(mode==='READINESS')return [['항목','점수','준비 상태'],...current.rows.map(v=>[v.item,v.score,v.status])];
 if(mode==='TABLE')return [current.headers,...current.rows];
 return null;
}
function docSections(){
 if(mode==='BUSINESS')return [...current.sections,['주의사항',current.caution]];
 if(mode==='FUNNEL')return [...current.stages.map(p=>[p.name,p.actions+'\n확인: '+p.proof]),['주의사항',current.caution]];
 if(mode==='BRIEF')return [
  ['요청 내용',current.userInputs.goal],['대상',current.userInputs.audience],
  ['원하는 결과',current.userInputs.output],['제약',current.userInputs.constraints],
  ['작업 단계',current.checklist.map((x,i)=>(i+1)+'. '+x).join('\n')],
  ['완료 기준',current.acceptance.join('\n')]
 ];
 throw Error('DOCUMENT_UNSUPPORTED');
}
async function exportCurrent(type){
 if(!current||downloadBusy)return;
 downloadBusy=true;
 try{
  let file;
  if(type==='markdown')file=saveBlob('THEFA_업무초안.md',toMarkdown(current),'text/markdown;charset=utf-8');
  if(type==='docx')file=saveBlob('THEFA_업무결과.docx',await docxFile(current.title,docSections()),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if(type==='csv')file=saveBlob('THEFA_계획표.csv',toCsv(rowsForExport()),'text/csv;charset=utf-8');
  if(type==='xlsx')file=saveBlob('THEFA_계획표.xlsx',await xlsxFile(rowsForExport(),{sheetName:'THE_FA_고객도구'}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if(!file)throw Error('EXPORT_TYPE_INVALID');
  updateStatus(file.name+' 파일을 이 브라우저에서 생성했습니다. ('+file.bytes+'바이트) · 서버 자동 저장 없음','success');
 }catch(err){updateStatus(errorText(err),'error')}
 finally{downloadBusy=false;}
}
function bind(){
 if(!$('toolkit-panel'))return;
 document.documentElement.dataset.toolkitContract=TOOLKIT_CONTRACT;
 document.querySelectorAll('[data-toolkit-mode]').forEach(b=>{
  b.addEventListener('click',()=>activeMode(b.dataset.toolkitMode));
  b.addEventListener('keydown',e=>{
    const tabs=[...document.querySelectorAll('[data-toolkit-mode]')];
    const index=tabs.indexOf(b);
    const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
    let target=null;
    if(direction)target=tabs[(index+direction+tabs.length)%tabs.length];
    else if(e.key==='Home')target=tabs[0];
    else if(e.key==='End')target=tabs.at(-1);
    if(target){e.preventDefault();activeMode(target.dataset.toolkitMode);target.focus();}
  });
 });
 $('toolkit-form').addEventListener('submit',e=>{
  e.preventDefault();
  try{current=collect();display(current);updateStatus('자료가 만들어졌습니다. 내용을 확인한 뒤 파일로 내려받으세요.','success');}
  catch(err){current=null;$('toolkit-result-actions').hidden=true;updateStatus(errorText(err),'error');}
 });
 document.querySelectorAll('[data-toolkit-download]').forEach(b=>b.addEventListener('click',()=>exportCurrent(b.dataset.toolkitDownload)));
 $('toolkit-quick-prompt').addEventListener('click',()=>{
  const prompt=$('toolkit-quick-prompt-text').value.trim();
  if(prompt.length<4){updateStatus('먼저 원하는 일을 적어 주세요.','error');return;}
  let next;try{next=detectIntent(prompt)}catch{next='BRIEF';}
  activeMode(next==='TABLE'?'BRIEF':next);
  const suggested={BRIEF:'goal',CONTENT:'product',FUNNEL:'offer',BUSINESS:'service',TABLE:'goal'};
  const fieldId=suggested[next]||'goal';
  const dest=$('toolkit-field-'+fieldId)||$('toolkit-field-goal');
  if(dest)dest.value=prompt;
  updateStatus('요청에 맞는 작업 종류를 추천했습니다. 빠진 정보만 채워 결과를 확인해 주세요.');
 });
 activeMode('BRIEF');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
