'use strict';
(() => {
 const $=s=>document.querySelector(s),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const num=n=>n==null?'확인 필요':Number(n).toLocaleString('ko-KR',{maximumFractionDigits:0});
 const won=n=>n==null?'확인 필요':Number(n).toLocaleString('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:n<100?2:0});
 const label=(id,text)=>{$('#'+id).textContent=text;};let snapshot=null,pricingSnapshot=null,pricingBusy=false,pricingUncertain=false;
 const views={
  overview:{title:'운영 대시보드',menu:'대시보드',description:'회원과 AI 이용 현황, 원가와 요금제를 한곳에서 확인하세요.'},
  members:{title:'회원 현황',menu:'회원 현황',description:'더파코어를 이용한 회원과 고객 작업공간을 확인하세요.'},
  providers:{title:'AI 연결 현황',menu:'AI 연결 현황',description:'고객에게 제공하는 AI와 실제 사용 기록을 확인하세요.'},
  usage:{title:'사용량·원가',menu:'사용량·원가',description:'공급사별 요청과 토큰 사용량, 누적 추정 원가를 확인하세요.'},
  billing:{title:'요금제·결제',menu:'요금제·결제',description:'서비스 가격과 제공 크레딧, 결제 연결 상태를 확인하세요.'},
  estimator:{title:'수익성 계산',menu:'수익성 계산',description:'회원 수와 AI 사용 조건을 바꾸어 예상 원가와 공헌이익을 계산하세요.'}
 };
 function menu(open){$('#sidebar').classList.toggle('is-open',open);$('#menu-toggle').setAttribute('aria-expanded',String(open));$('#menu-toggle').setAttribute('aria-label',open?'관리자 메뉴 닫기':'관리자 메뉴 열기');$('#sidebar-scrim').hidden=!open;}
 function activateView(focus=false){
  const requested=location.hash.slice(1),name=Object.hasOwn(views,requested)?requested:'overview',view=views[name];
  document.querySelectorAll('[data-view]').forEach(section=>section.hidden=section.id!==name);
  document.querySelectorAll('[data-nav]').forEach(link=>{if(link.dataset.nav===name)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  label('page-title',view.title);label('page-description',view.description);label('breadcrumb-title',view.menu);
  document.title=view.menu+' | THE FA Core 관리자';menu(false);
  if(focus){window.scrollTo({top:0,behavior:'instant'});$('#page-title').focus({preventScroll:true});}
 }

 function chart(days){
  const box=$('#chart');box.replaceChildren();const rows=days.slice(-14);
  if(!rows.length){const n=el('div',undefined,'chart-empty');n.append(el('strong','아직 기록된 요청이 없습니다.'),el('p','새 고객 AI 요청이 저장되면 이곳에 표시됩니다.'));box.append(n);return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 240');svg.setAttribute('role','img');svg.setAttribute('aria-label','일별 실제 요청 수');
  const max=Math.max(...rows.map(d=>d.requests),1),w=700/rows.length;
  rows.forEach((d,i)=>{const x=35+i*w,h=d.requests/max*155,r=document.createElementNS(ns,'rect');r.setAttribute('x',x+8);r.setAttribute('y',195-h);r.setAttribute('width',Math.max(w-16,4));r.setAttribute('height',h);r.setAttribute('rx','4');r.setAttribute('fill','#d7b377');svg.append(r);for(const [y,text]of[[216,d.day.slice(5)],[185-h,String(d.requests)]]){const t=document.createElementNS(ns,'text');t.setAttribute('x',x+w/2);t.setAttribute('y',y);t.setAttribute('fill','#dcd3c3');t.setAttribute('font-size','12');t.setAttribute('text-anchor','middle');t.textContent=text;svg.append(t);}});box.append(svg);
 }
 function render(v){
  const m=v.membership,c=v.cost;
  label('overview-members',num(m.confirmedMembers));label('overview-requests',num(c.requests));
  label('overview-cost',won(c.estimatedKrwMicros==null?null:c.estimatedKrwMicros/1e6));
  label('overview-payment',v.finance.paymentConnected?'결제 연결됨':'결제 미연결');
  label('overview-workspaces',num(m.customerWorkspaces)+'개');label('overview-providers',num(v.providers.length)+'종');
  for(const [key,planId] of [['overview-standard','STANDARD'],['overview-pro','PRO']]){
   const plan=v.pricing.plans.find(p=>p.id===planId);label(key,plan?won(plan.priceGrossKrw)+' / 월':'확인 필요');
  }
  label('overview-subscription',v.finance.paymentConnected?'연결됨':'연결 준비 중');

  label('member-count',num(m.confirmedMembers));label('active-members',num(m.activeLast30Days));label('new-members',num(m.firstObservedLast30Days));label('workspaces',num(m.customerWorkspaces));
  label('legacy-label','회원 확인 전 기존 작업공간 '+num(m.legacyWorkspacesWithoutMarker)+'개');
  label('requests',num(c.requests));label('request-detail','답변 '+num(c.successfulRequests)+' · 확인 필요 '+num(c.failedRequests)+' · 저장 확인 중 '+num(c.pendingRequests));
  label('tokens',c.inputTokens==null?'확인 필요':num(c.inputTokens+c.outputTokens));label('cost',won(c.estimatedKrwMicros==null?null:c.estimatedKrwMicros/1e6));label('cost-gaps',num(c.costEvidenceGaps));
  label('data-status',c.costEvidenceGaps?'일부 원가 확인 필요 · 확인된 부분 '+won(c.verifiedSubsetKrwMicros/1e6):'최신 회원·AI 사용 기록을 불러왔습니다.');
  const grid=$('#provider-grid');grid.replaceChildren();for(const p of v.providers){const card=el('article',undefined,'provider-card');card.append(el('h3',p.name),el('p',p.modelId,'provider-description'),el('p','고객 업무 모드: '+p.mode),el('span',p.observedRequests?'사용 기록 '+num(p.observedRequests)+'건':'첫 사용 기록 대기','status-label'));grid.append(card);}
  const body=$('#usage-body');body.replaceChildren();for(const p of v.providers){const u=c.byProvider.find(x=>x.provider===p.id);const tr=el('tr');[p.name,num(u?.requests??0),u?.gaps?'확인 필요':num(u?.inputTokens??0),u?.gaps?'확인 필요':num(u?.outputTokens??0),u?.gaps?'일부 확인 필요':won((u?.estimatedKrwMicros??0)/1e6)].forEach(x=>tr.append(el('td',x)));body.append(tr);}
  chart(c.byDay);
  const plans=$('#plan-grid');plans.replaceChildren();for(const p of v.pricing.plans){const a=el('article',undefined,'panel plan-panel');a.append(el('p',p.name,'plan-label'),el('strong',p.priceGrossKrw===null?'별도 문의':won(p.priceGrossKrw)+(p.billingPeriod==='month'?' / 월':'')),el('p',p.id==='FREE'?'무료 체험 '+num(p.freeTrialAnswers)+'회':p.credits===null?'5인 이상 · 도입 범위 협의':num(p.credits)+' 크레딧 = '+num(p.credits)+'원 / 월'),el('span',p.id==='FREE'?'무료 이용 가능':p.id==='ENTERPRISE'?'thefa@thefa.kr':'가격 적용 · 결제 준비 중','plan-state'));plans.append(a);}
  const select=$('#estimate-model'),selected=select.value;select.replaceChildren();for(const p of v.providers){const o=el('option',p.name+' · '+p.modelId);o.value=p.modelId;select.append(o);}if(selected)select.value=selected;calculate();
 }
 function calculate(){
  if(!snapshot)return;const f=$('#estimate-form');if(!f.checkValidity()){label('estimate-profit','입력값 확인');return;}
  const n=id=>Number($('#estimate-'+id).value),p=snapshot.pricing.plans.find(x=>x.id===$('#estimate-plan').value),r=snapshot.modelPrices.find(x=>x.id===$('#estimate-model').value);if(!p||!r)return;
  const count=n('members'),usedCredits=count*p.credits*n('use')/100,cache=n('cache')/100;
  const inputRate=Math.max(r.inputUsdPerToken,r.cacheWriteShortUsdPerToken,r.cacheWriteLongUsdPerToken);
  const unit=(n('input')*((1-cache)*inputRate+cache*r.cacheReadUsdPerToken)+n('output')*r.outputUsdPerToken)*n('fx');
  const policy=snapshot.pricing.pricingPolicy;const retailUnit=Math.max(policy.minimumChargeCredits,Math.ceil(unit*policy.markupBps/10000)),answers=usedCredits/retailUnit;
  const gross=count*p.priceGrossKrw,net=gross/1.1,ai=answers*unit,fee=gross*n('pg')/100*1.1,fixed=n('infra')+n('support')+n('other'),profit=net-ai-fee-fixed,margin=net?profit/net*100:0;
  label('estimate-profit',won(profit));label('estimate-margin','공헌이익률 '+margin.toFixed(1)+'% · '+(margin>=40?'목표 40% 이상':'목표 40% 미만'));label('estimate-net',won(net));label('estimate-ai',won(ai));label('estimate-fee',won(fee));label('estimate-fixed',won(fixed));label('estimate-answers',num(answers)+'회');label('estimate-unit',won(unit));
 }
 async function refresh(){
  const button=$('#refresh-button');button.disabled=true;$('.data-bar').dataset.state='loading';label('data-status','운영 데이터를 확인 중입니다.');
  try{const r=await fetch('/api/customer-operations',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});if(r.status===401){location.assign('/login.html?reason=session-expired');return;}if(!r.ok)throw Error('READ_FAILED');const v=await r.json();if(v.contract!=='THEFA_CORE_CUSTOMER_OPERATIONS_V1'||v.coverage!=='COMPLETE_CURRENT_PRODUCT_MARKERS')throw Error('COVERAGE_UNVERIFIED');snapshot=v;render(v);$('.data-bar').dataset.state='ready';label('snapshot-date',new Date(v.observedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' 기준');}
  catch{
   snapshot=null;$('.data-bar').dataset.state='error';document.querySelectorAll('[data-metric]').forEach(e=>e.textContent='확인 불가');
   ['overview-workspaces','overview-providers','overview-standard','overview-pro','overview-subscription','overview-payment'].forEach(id=>label(id,'확인 불가'));
   $('#provider-grid').replaceChildren(el('p','AI 현황을 불러올 수 없습니다.','description'));$('#usage-body').replaceChildren();
   $('#chart').replaceChildren(el('p','현재 기록을 불러올 수 없습니다.','description'));$('#plan-grid').replaceChildren(el('p','최신 요금제 정보를 확인하지 못했습니다.','description'));
   $('#estimate-model').replaceChildren();['profit','net','ai','fee','fixed','answers','unit'].forEach(id=>label('estimate-'+id,'—'));
   label('estimate-margin','최신 단가를 불러온 후 계산할 수 있습니다.');label('snapshot-date','최신 조회 실패');
   label('data-status','집계 연결을 확인하지 못했습니다. 새로고침으로 다시 확인해 주세요.');
  }
  finally{button.disabled=false;}
 }
 function pricingControls(){
  const disabled=pricingBusy||pricingUncertain||!pricingSnapshot;
  ['markup','minimum','fx','standard','pro'].forEach(k=>$('#pricing-'+k).disabled=disabled);
  $('#pricing-save').disabled=disabled;$('#pricing-reload').disabled=pricingBusy;
 }
 function pricingExample(){const value=Math.max(Number($('#pricing-minimum').value),Math.ceil(500*Number($('#pricing-markup').value)));label('pricing-example',num(value)+' 크레딧 = '+num(value)+'원');}
 async function loadPricing(){
  if(pricingBusy)return;pricingBusy=true;pricingControls();label('pricing-status','현재 저장된 정책을 확인하고 있습니다.');
  try{const r=await fetch('/api/pricing-policy',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});if(r.status===401){location.assign('/login.html?reason=session-expired');return;}if(!r.ok)throw Error();const data=await r.json();
   if(data.policy?.contract!=='THEFA_COST_BASED_CREDITS_V1'||!Array.isArray(data.history))throw Error();pricingSnapshot=data.policy;pricingUncertain=false;
   const p=data.policy;$('#pricing-markup').value=p.markupBps/10000;$('#pricing-minimum').value=p.minimumChargeCredits;$('#pricing-fx').value=p.fxKrwPerUsd;$('#pricing-standard').value=p.standardMonthlyCredits;$('#pricing-pro').value=p.proMonthlyCredits;
   label('pricing-revision','정책 '+p.revision);pricingExample();const history=$('#pricing-history');history.replaceChildren();
   if(!data.history.length)history.append(el('li','기본 정책 · 원가 2배 · 1크레딧 = 1원. 저장된 변경 이력이 없습니다.'));
   for(const entry of data.history.slice(0,20)){const p=entry.policy;history.append(el('li',new Date(p.effectiveAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · 정책 '+p.revision+' · 원가 '+(p.markupBps/10000)+'배 · 환율 '+num(p.fxKrwPerUsd)+'원 · 최소 '+num(p.minimumChargeCredits)+'크레딧'));}
   label('pricing-status','현재 정책을 확인했습니다. 저장하면 이후 시작하는 요청에 적용됩니다.');
  }catch{pricingSnapshot=null;label('pricing-status','정책을 확인하지 못했습니다. 저장은 중단된 상태입니다. 현재 정책 확인을 눌러 주세요.');}
  finally{pricingBusy=false;pricingControls();}
 }
 async function savePricing(event){
  event.preventDefault();if(pricingBusy||pricingUncertain||!pricingSnapshot||!$('#pricing-form').reportValidity())return;
  const config={markupBps:Math.round(Number($('#pricing-markup').value)*10000),minimumChargeCredits:Number($('#pricing-minimum').value),fxKrwPerUsd:Number($('#pricing-fx').value),standardMonthlyCredits:Number($('#pricing-standard').value),proMonthlyCredits:Number($('#pricing-pro').value)};
  const requestId='pricing-'+crypto.randomUUID(),expectedVersion=pricingSnapshot.version;pricingBusy=true;pricingControls();label('pricing-status','정책을 저장하고 있습니다.');
  try{const r=await fetch('/api/pricing-policy',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,expectedVersion,config}),signal:AbortSignal.timeout(20000)});
   if(r.status===401){location.assign('/login.html?reason=session-expired');return;}
   const data=await r.json();if(!r.ok||data.policy?.contract!=='THEFA_COST_BASED_CREDITS_V1'||!data.savedPolicyVersion)throw Error();
   pricingSnapshot=data.policy;label('pricing-status','정책 '+data.policy.revision+' 저장이 확인되었습니다. 이후 새 요청부터 적용됩니다.');label('pricing-revision','정책 '+data.policy.revision);refresh();
   const entry=el('li',new Date(data.policy.effectiveAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · 정책 '+data.policy.revision+' · 원가 '+(data.policy.markupBps/10000)+'배');$('#pricing-history').prepend(entry);
  }catch{pricingUncertain=true;label('pricing-status','저장 결과를 확인하지 못했습니다. 중복 저장을 멈췄습니다. 현재 정책 확인에서 변경 이력을 확인해 주세요.');}
  finally{pricingBusy=false;pricingControls();}
 }
 $('#pricing-form').addEventListener('submit',savePricing);$('#pricing-form').addEventListener('input',pricingExample);$('#pricing-reload').addEventListener('click',loadPricing);
 async function logout(){
  const button=$('#logout-button');button.disabled=true;button.textContent='로그아웃 중…';
  try{
   const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(15000)});
   if(response.status!==401){if(!response.ok)throw Error('LOGOUT_FAILED');const result=await response.json();if(result.loggedOut!==true)throw Error('LOGOUT_UNVERIFIED');}
   location.replace('/login.html');
  }catch{button.disabled=false;button.textContent='로그아웃';$('.data-bar').dataset.state='error';label('data-status','로그아웃 결과를 확인하지 못했습니다. 새로고침 후 로그인 상태를 확인해 주세요.');}
 }
 $('#refresh-button').addEventListener('click',refresh);$('#logout-button').addEventListener('click',logout);
 $('#estimate-form').addEventListener('input',calculate);$('#estimate-form').addEventListener('submit',e=>e.preventDefault());
 $('#menu-toggle').addEventListener('click',()=>menu(!$('#sidebar').classList.contains('is-open')));
 $('#sidebar-scrim').addEventListener('click',()=>menu(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')menu(false);});
 document.querySelectorAll('.side-nav a').forEach(a=>a.addEventListener('click',()=>menu(false)));
 window.addEventListener('hashchange',()=>activateView(true));activateView();refresh();loadPricing();
})();

