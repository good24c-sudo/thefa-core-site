/**
 * THE FA Core Customer Toolkit V1 — browser-local deterministic workflows.
 * Does not call LLM/SEO APIs, scrape maps, store identities, submit financial applications or publish content.
 * Customer input and downloaded files never leave the browser through this module.
 */
export const TOOLKIT_CONTRACT='THEFA_CUSTOMER_WORKKIT_LOCAL_V1';
export const MODES=Object.freeze(['BRIEF','FUNNEL','CONTENT','BUSINESS','READINESS','TABLE']);
export const READINESS_CATEGORIES=Object.freeze({
  profile:Object.freeze([
    '업력과 사업자 정보 확인','실제 업종 확인','매출 근거 확인','고용 자료 확인',
    '사업장 소재지·계약 확인','재무·신용 관련 자료 확인','자금 목적·금액 정리']),
  evidence:Object.freeze([
    '최근 세금 서류 준비','4대보험 등 인원 자료 준비','매출 자료 간 숫자 대조',
    '사업자·대표자 명의 확인','업종과 허가 사항 확인','사업장 주소·계약 확인',
    '자금 사용처 증빙 확인','해당 공고의 최신 신청 요건 확인']),
  schedule:Object.freeze([
    '1주차: 회사·사업자 자료 수집','1주차: 매출·세금 자료 대조','1주차: 인원·사업장 자료 확인','1주차: 누락 자료 목록 작성',
    '2주차: 필요 금액과 사용처 정리','2주차: 가격·매출 근거 정리','2주차: 상환 가능성 검토','2주차: 사업계획 초안 작성',
    '3주차: 최신 공식 공고 확인','3주차: 대상·기간·자격 검증','3주차: 관련 기관 상담','3주차: 최종 서류 대조']),
});
const NONFACT='이 문서는 입력하신 정보로 만든 검토용 초안입니다. 실제 실적·검색순위·승인 가능성은 확인되지 않았습니다.';
function text(v,max=400){
  if(typeof v!=='string')throw Error('TEXT_REQUIRED');
  const s=v.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ').trim();
  if(s.length>max)throw Error('INPUT_TOO_LONG');
  return s;
}
function required(v,name,max=400){
  const s=text(v??'',max);
  if(s.length<2)throw Error('REQUIRED_'+name);
  return s;
}
const stage=(name,why,actions,proof)=>Object.freeze({name,why,actions,proof});
export function detectIntent(goal){
 const q=required(goal,'GOAL',1200).toLowerCase();
 if(/릴스|숏폼|인스타|스레드|sns|홍보 글|광고 콘텐츠|캡션/.test(q))return 'CONTENT';
 if(/정책자금|융자|사업계획서|자금계획|상환/.test(q))return 'BUSINESS';
 if(/상권|경쟁|마케팅|유입|퍼널|재방문|매출|구매 전환/.test(q))return 'FUNNEL';
 if(/업체|리스트|엑셀|csv|표|시트|데이터 정리/.test(q))return 'TABLE';
 return 'BRIEF';
}
export function makeWorkBrief({goal,audience='',output='',constraints=''}) {
 const g=required(goal,'GOAL',1200),who=text(audience,180)||'추가 확인 필요',
  deliver=text(output,180)||'작업 결과와 근거 자료',
  guard=text(constraints,360)||'기존 데이터·계정·저장소를 변경하지 않음';
 const mode=detectIntent(g);
 return {
  mode,title:'업무지시 초안',status:'REVIEW_REQUIRED',userInputs:{goal:g,audience:who,output:deliver,constraints:guard},
  checklist:['입력과 목표 대조','공식 데이터·현재 연결 상태 확인','허용된 도구·비용·권한 검증',
             '결과물 제작 및 독립 검토','근거·결과 파일 확인'],
  acceptance:['요청한 형식의 파일을 열어 확인할 수 있음','확인되지 않은 숫자·성과를 임의 작성하지 않음',
    '외부 게시·발송·운영 변경은 별도 승인','수정하거나 다시 사용 가능한 결과물'],
  suggestedTool:mode,source:'USER_INPUT_ONLY',aiCalled:false
 };
}
export function buildFunnel({business,offer,audience,channels='',goal=''}) {
 const b=required(business,'BUSINESS',200),o=required(offer,'OFFER',300),
  a=required(audience,'AUDIENCE',180),ch=text(channels,200)||'채널은 확인되지 않음',
  g=text(goal,220)||'문의 및 고객 행동의 실제 전환';
 return {title:b+' 고객 유입·전환 설계',source:'USER_INPUT_ONLY',aiCalled:false,
  inputs:{business:b,offer:o,audience:a,channels:ch,goal:g},
  stages:[
   stage('발견',a+'이 있는 채널에서 발견','채널별 도달 경로를 검토하고 실제 집행값을 확인','유입 수·출처(확인 가능한 경우)'),
   stage('관심',o+'에 관심','제품의 해결 문제와 실제 사례를 제시','조회 후 관심 행동'),
   stage('문의',a+'의 문의 발생','비용·신청 절차·동의 조건을 명확히 고지','동의한 문의 수'),
   stage('신뢰','검증된 근거를 제공','근거 없는 매출·효과·고객 수치를 제거','근거 확인 가능 여부'),
   stage('이용','고객이 명시적으로 선택','가격과 조건 확인 후 신청·구매·방문','확인된 실제 이용'),
   stage('성과','목표 '+g,'실제 행동과 재방문 등 검증된 결과를 따로 측정','Verified Revisit(해당 시) / 검증된 성과')
  ],
  nextActions:['현재 유입 데이터 확인','채널은 실제 고객이 있는 곳 위주로 선별','성과 측정 기간·동의 여부 설정'],
  caution:'이 설계는 실시간 상권·검색·경쟁사·매출 정보를 조회하지 않았습니다. '+NONFACT
 };
}
const TOPICS=['고객이 겪는 불편','실제 사용 장면','문제 해결 과정','비교할 선택 기준','검증 가능한 후기 또는 자료','자주 묻는 질문','행동 유도 및 다음 안내'];
const TYPES=['릴스 구성','캐러셀 기획','짧은 글','설명 영상 대본','이미지 카드','질문·답변','요약 콘텐츠'];
export function buildContentCalendar({brand,product,audience,channel='Instagram'}){
 const b=required(brand,'BRAND',180),p=required(product,'PRODUCT',220),
  a=required(audience,'AUDIENCE',180),ch=required(channel,'CHANNEL',70);
 return {title:b+' 7회 콘텐츠 계획',source:'USER_INPUT_ONLY',aiCalled:false,
 rows:TOPICS.map((t,i)=>({
  cycle:'회차 '+(i+1),channel:ch,format:TYPES[i],topic:t,
  subject:p,hook:'['+a+']에게 '+t+'를 설명하기',
  cta:i===6?'실제 이용 조건을 확인해 주세요':'제품 설명·근거 자료를 확인해 주세요',
  approval:'게시 전 사람 검토 필요'
 })),
 caution:'콘텐츠 초안일 뿐 실제 검색 트렌드·광고 성과 분석·SNS 게시는 수행하지 않았습니다.'
 };
}
export function buildBusinessPlan({business,service,customer,amount='',use='',revenueProof=''}) {
 const b=required(business,'BUSINESS',180),s=required(service,'SERVICE',240),
  a=required(customer,'CUSTOMER',180),
  money=text(amount,70),purpose=text(use,350),proof=text(revenueProof,350);
 const sections=[
  ['사업 핵심요약',b+'은 '+a+'에게 '+s+'을(를) 제공합니다.'],
  ['기업 및 사업현황','상세 사업자·업력·팀·제품 현황: 실제 증빙 필요'],
  ['고객의 문제와 해결 방법','대상: '+a+' / 제공 가치: '+s],
  ['시장 및 경쟁','공식 자료·시점·출처 확인 전까지 시장 규모와 경쟁 순위를 임의 작성하지 않습니다.'],
  ['판매 및 마케팅','고객을 확보하는 경로·전환 성과를 실제 자료로 검증해야 합니다.'],
  ['필요 자금과 사용처','신청 검토 금액: '+(money||'미정')+' / 사용 목적: '+(purpose||'추가 확인 필요')],
  ['사업 개선과 기대효과','사용 후 변화·매출/비용 가정 및 기간을 확인해야 합니다.'],
  ['매출·상환 근거','현재 제공 근거: '+(proof||'입력 없음 - 재무자료를 근거로 채워야 합니다.')],
  ['향후 실행 일정','실제 공고·접수 마감·기관 안내와 대조해 준비 일정 확정'],
  ['미확인 자료','최신 공식 공고, 자격, 세금·재무·사업장·신용 관련 서류를 확인하지 않았습니다.']
 ];
 return {title:b+' 사업계획서 초안',source:'USER_INPUT_ONLY',aiCalled:false,sections,
 caution:'정책자금 승인·대출 가능 여부를 평가하거나 보장하지 않습니다. 공고·재무정보·전문가 검토가 필요합니다.'};
}
export function assessReadiness(category,answers){
 const items=READINESS_CATEGORIES[category];
 if(!items||!Array.isArray(answers)||answers.length!==items.length)throw Error('CHECKLIST_INVALID');
 const rows=items.map((label,i)=>{
  const score=answers[i]; if(![0,1,2].includes(score))throw Error('ANSWER_INVALID');
  return {item:label,score,status:score===2?'확인됨':score===1?'추가 확인':'미준비'}
 });
 const points=rows.reduce((v,r)=>v+r.score,0);
 return {title:'준비사항 확인',rows,points,maxPoints:items.length*2,scoring:'USER_SELF_CHECK_ONLY',
 caution:'이 점수는 내부 준비도 표시이며 정부·금융기관의 공식 심사 점수, 자격, 승인 확률이 아닙니다.',
 next:rows.filter(x=>x.score<2).map(x=>x.item)};
}
// RFC-4180 CSV with quoted embedded newlines. Rejects fields that exceed safe parsing bounds.
export function parseCsv(input){
 const s=text(input,120000).replace(/^\uFEFF/,'');
 const rows=[];let current=[],cell='',quoted=false;
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){
   if(c==='"'&&s[i+1]==='"'){cell+='"';i++}
   else if(c==='"')quoted=false;else cell+=c;
  }else if(c==='"'&&cell==='')quoted=true;
  else if(c===','){current.push(cell);cell=''}
  else if(c==='\n'){current.push(cell.replace(/\r$/,''));rows.push(current);current=[];cell=''}
  else cell+=c;
  if(cell.length>2500||current.length>40||rows.length>600)throw Error('CSV_TOO_LARGE');
 }
 if(quoted)throw Error('CSV_UNCLOSED_QUOTE');
 if(cell!==''||current.length){current.push(cell.replace(/\r$/,''));rows.push(current)}
 if(rows.length<2||rows[0].length<1)throw Error('CSV_ROWS_REQUIRED');
 const cols=rows[0].length;
 if(cols>30||rows.some(r=>r.length!==cols))throw Error('CSV_UNEVEN_COLUMNS');
 return rows;
}
const protectCsvCell=v=>{
 const raw=String(v??'');
 return /^[ \t]*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
};
export function toCsv(rows){
 if(!Array.isArray(rows)||rows.length===0||rows.length>700)throw Error('CSV_OUT_ROWS_INVALID');
 return '\uFEFF'+rows.map(r=>{
  if(!Array.isArray(r)||r.length>40)throw Error('CSV_OUT_COLUMNS_INVALID');
  return r.map(v=>'"'+protectCsvCell(v).replace(/"/g,'""')+'"').join(',');
 }).join('\r\n')+'\r\n';
}
export function analyzeImportedTable(rows,{sortColumn=null}={}){
 if(!Array.isArray(rows)||rows.length<2)throw Error('TABLE_EMPTY');
 const header=rows[0],data=rows.slice(1);
 const sorted=[...data];
 if(sortColumn!==null){
   if(!Number.isInteger(sortColumn)||sortColumn<0||sortColumn>=header.length)throw Error('SORT_COLUMN_INVALID');
   sorted.sort((a,b)=>String(a[sortColumn]).localeCompare(String(b[sortColumn]),'ko'));
 }
 const filled=data.filter(r=>r.some(v=>String(v).trim())).length;
 return {headers:[...header],rows:sorted,source:'USER_IMPORTED_CSV',totalRows:filled,verifiedExternally:false,
 caveat:'사용자가 선택한 파일의 값만 정리했습니다. 외부 사업장·평점·검색 순위의 사실 여부는 확인하지 않았습니다.'};
}
export function toMarkdown(result) {
 if(result.title&&result.sections)return '# '+result.title+'\n\n'+result.sections.map(([h,v])=>'## '+h+'\n'+v).join('\n\n')+'\n\n> '+result.caution+'\n';
 if(result.title&&result.stages)return '# '+result.title+'\n\n'+result.stages.map((s,i)=>'## '+(i+1)+'. '+s.name+'\n- 목표: '+s.why+'\n- 실행: '+s.actions+'\n- 검증: '+s.proof).join('\n\n')+'\n\n> '+result.caution+'\n';
 if(result.title&&result.checklist)return '# '+result.title+'\n\n'+Object.entries(result.userInputs).map(([k,v])=>'- '+k+': '+v).join('\n')+'\n\n## 단계\n'+result.checklist.map((x,i)=>(i+1)+'. '+x).join('\n')+'\n\n## 완료 기준\n'+result.acceptance.map(x=>'- '+x).join('\n')+'\n';
 throw Error('MARKDOWN_UNSUPPORTED');
}
