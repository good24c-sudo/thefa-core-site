import {createAvaSecondBrainP0, PROFILE_SECTIONS, P0_CONTRACT} from './ava-secondbrain-p0-model.mjs';
/**
 * P0 never reads a real customer memory or authenticates a browser owner.
 * The existing guest-live auth, conversation and R6 workspace remain unchanged.
 */
(() => {
  const app=document.getElementById('app');
  const main=document.getElementById('chat-main');
  const chat=document.getElementById('chat-panel');
  const flow=chat?.querySelector('.chat-flow');
  if(!app||!main||!chat||!flow)return;
  const model=createAvaSecondBrainP0();
  const tabs=[['ask','물어보기'],['memory','나의 기억'],['about','나에 대해'],['sources','연결 소스'],['map','기억 지도']];
  const state={tab:'ask',lastSearch:null,question:'',device:'ALL',editingId:null,open:false,hiddenBefore:null,status:'기억 사용 동의 전 · 합성 기억만 시험할 수 있습니다.',statusKind:'DENIED'};
  function el(tag,cls,text){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=String(text);
    return n;
  }
  function button(label,op,id,cls){
    const b=el('button',cls||'ava-p0-btn',label);
    b.type='button';b.dataset.op=op;
    if(id)b.dataset.id=id;
    return b;
  }
  const root=el('section','r6-inline-pane ava-p0-shell');
  root.id='ava-secondbrain-root';
  root.hidden=true;
  root.setAttribute('aria-label','나의 AVA · 합성 기억 기반 SecondBrain 시연');
  const header=el('div','ava-p0-top');
  const heading=el('div');
  heading.append(el('small','','THE FA CORE / PERSONAL MEMORY'),el('h2','','나의 AVA · 나를 위한 두 번째 기억'));
  heading.append(el('p','','찾기 · 확인하기 · 정정하기 · 나의 목표 연결하기'));
  const close=button('← 대화로 돌아가기','close',null,'ava-p0-btn');
  close.id='ava-p0-close';header.append(heading,close);
  const scroll=el('div','ava-p0-scroll');
  const measure=el('div','ava-p0-measure');
  const banner=el('div','ava-p0-banner');
  const summary=el('div');
  summary.append(el('strong','','내 기억에 질문하고, 근거를 확인하세요.'));
  summary.append(el('p','','현재는 사용자 기록을 읽지 않는 격리 시연입니다. 동의한 합성 예시만 사용합니다.'));
  banner.append(summary,el('span','ava-p0-synthetic-tag','합성 기록 시연 · 실계정 미연결'));
  const controls=el('div','ava-p0-toolbar');
  const consentLabel=el('label');
  const consent=el('input');consent.type='checkbox';consent.id='ava-p0-consent';
  consentLabel.append(consent,document.createTextNode('합성 기억 시연 사용 동의'));
  const seed=button('예시 기억 3개 불러오기','seed');
  seed.id='ava-p0-seed';
  const revoke=button('시연 기억 전체 사용 중지','revoke');
  revoke.id='ava-p0-revoke';
  controls.append(consentLabel,seed,revoke,el('p','muted','실제 고객 자료·서버 저장·AI API 호출 없음'));
  const tabsElement=el('div','ava-p0-tabs');tabsElement.setAttribute('role','tablist');tabsElement.setAttribute('aria-label','나의 AVA 메뉴');
  for(const [id,label] of tabs){
    const tab=button(label,'tab',id);
    tab.id='ava-p0-tab-'+id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','ava-p0-panel');
    tabsElement.append(tab);
  }
  const body=el('div','ava-p0-content');
  body.id='ava-p0-panel';body.setAttribute('role','tabpanel');body.setAttribute('aria-live','polite');
  measure.append(banner,controls,tabsElement,body);
  scroll.append(measure);root.append(header,scroll);
  flow.append(root);
  root.dataset.avaP0Contract=P0_CONTRACT;

  function info(text,kind){
    state.status=text;state.statusKind=kind||'';
  }
  function safeStatus(pane){
    const box=el('p','ava-p0-status',state.status);
    box.id='ava-p0-status';box.setAttribute('role','status');box.dataset.state=state.statusKind;
    pane.append(box);
  }
  function panelTitle(title,caption){
    const head=el('div','ava-p0-section-head');head.append(el('h3','',title),el('p','',caption));return head;
  }
  function empty(txt){return el('div','ava-p0-empty',txt)}
  function memoryMetadata(m){
    return '출처: '+m.source+' · 기록일 '+m.date+' · '+m.device+' · 버전 '+m.revision+' · 합성 시연 · 고객 인증 없음';
  }
  function metaCard(m){
    const card=el('article','ava-p0-card');
    card.append(el('span','ava-p0-chip',m.device+' · '+m.status));
    card.append(el('h4','',m.topic||'합성 기억'));
    card.append(el('p','',m.text));
    card.append(el('small','',memoryMetadata(m)));
    return card;
  }
  function renderAsk(pane){
    pane.append(panelTitle('내 기억에 물어보기','허용한 합성 기록에서만 답을 찾아 출처와 날짜를 표시합니다. 실제 개인 기억이나 생성형 AI 응답이 아닙니다.'));
    const form=el('form','ava-p0-ask');form.id='ava-p0-search';
    const input=el('input');input.id='ava-p0-question';input.placeholder='예: 기존 코드 재사용에 대해 어떤 결정을 했지?';
    input.type='search';input.maxLength=400;input.required=true;input.minLength=2;input.value=state.question;
    input.setAttribute('aria-label','합성 기억 질문');
    const select=el('select');select.id='ava-p0-device';select.setAttribute('aria-label','검색할 기기 선택');
    for(const [value,label] of [['ALL','모든 기기'],['PHONE','휴대폰 예시만'],['PC','PC 예시만']]){
      const option=el('option','',label);option.value=value;select.append(option);
    }
    select.value=state.device;
    const submit=el('button','ava-p0-btn primary','근거 찾기');submit.type='submit';submit.id='ava-p0-submit';
    form.append(input,select,submit);pane.append(form);
    const suggestions=el('div','ava-p0-hints');
    for(const q of ['개발 원칙에 대해 무슨 결정을 했지?','카페 조사의 기준은?','사용자 자료 보호를 어떻게 정했지?']){
      const b=button(q,'example-question');b.dataset.question=q;suggestions.append(b);
    }
    pane.append(suggestions);
    safeStatus(pane);
    if(!state.lastSearch)return;
    const result=state.lastSearch;
    if(result.status!=='GROUNDED_SYNTHETIC'){pane.append(empty('근거를 확인하지 못했습니다. 동의·질문 범위·자료 상태를 확인해 주세요.'));return;}
    const list=el('div','ava-p0-grid');
    for(const m of result.results){
      const card=el('article','ava-p0-card');
      card.append(el('span','ava-p0-chip','합성 출처 · '+m.device),el('h4','',m.topic),el('p','',m.text));
      card.append(el('small','','출처: '+m.source+' · '+m.sourceDate+' · 개정 '+m.revision+' · '+m.sourceRef));
      list.append(card);
    }
    pane.append(list);
  }
  function renderMemories(pane){
    const s=model.snapshot();
    pane.append(panelTitle('나의 기억','기억을 정정하면 이전 버전은 즉시 검색에서 제외되고 명시적으로 다시 승인해야 합니다.'));
    safeStatus(pane);
    if(!s.consent.memory){pane.append(empty('아직 기억 검색에 동의하지 않았습니다. 위에서 합성 기억 시연 사용에 동의해 주세요.'));return;}
    if(!s.memories.length){pane.append(empty('합성 기억이 없습니다. 예시 기록을 불러오면 이곳에서 확인하고 정정할 수 있습니다.'));return;}
    const list=el('div','ava-p0-grid');
    for(const m of s.memories){
      const card=metaCard(m);
      const controls=el('div','ava-p0-actions');
      if(m.status==='APPROVED'){
        controls.append(button('기억 수정','edit',m.id),button('사용 중지','disable',m.id));
        if(state.editingId===m.id){
          const textarea=el('textarea');textarea.id='ava-p0-edit-text';textarea.maxLength=350;textarea.value=m.text;
          textarea.setAttribute('aria-label','수정할 합성 기억 내용');
          card.append(textarea);
          controls.append(button('수정 적용','save-correction',m.id),button('취소','cancel-edit',m.id));
        }
      }else if(m.status==='PENDING'){
        controls.append(button('정정안 다시 승인','approve',m.id),el('small','','재승인 전 검색되지 않습니다.'));
      }else {
        controls.append(el('small','','사용 중지된 기억은 검색 및 지도에서 제외합니다.'));
      }
      card.append(controls);list.append(card);
    }
    pane.append(list);
  }
  function renderAbout(pane){
    pane.append(panelTitle('나에 대해','젠스파크 About Me를 참고해 설계한 더파의 여섯 영역입니다. 실제 개인 분석이 아닌 합성 기억 제안입니다.'));
    safeStatus(pane);
    const list=el('div','ava-p0-grid');
    for(const item of model.profile()){
      const card=el('article','ava-p0-card');
      card.append(el('span','ava-p0-chip '+(item.status==='PROPOSED'?'pending':''),item.status==='CONFIRMED_DEMO'?'시연 확인':item.status==='REJECTED_DEMO'?'시연 거부':'AI 후보 · 미확인'));
      card.append(el('h4','',item.label),el('p','',item.candidate));
      card.append(el('small','','근거 '+item.sourceRefs.length+'건 · 합성 시연 · 실제 사용자 프로필로 저장하지 않음'));
      const actions=el('div','ava-p0-actions');
      if(item.sourceRefs.length&&item.status==='PROPOSED')
        actions.append(button('후보 시연 확인','profile-confirm',item.key),button('후보 거부','profile-reject',item.key));
      if(!item.sourceRefs.length)actions.append(el('small','','근거가 부족하여 개인 사실로 확정할 수 없습니다.'));
      card.append(actions);list.append(card);
    }
    pane.append(list);
  }
  function renderSources(pane){
    pane.append(panelTitle('연결 소스','실제 고객·Phone·PC 및 외부 앱은 연결 상태가 미검증입니다. 합성 자료와 실제 연결을 구분합니다.'));
    safeStatus(pane);
    const list=el('div','ava-p0-sources');
    for(const s of model.sources()){
      const row=el('div','ava-p0-source-row');
      const content=el('div');content.append(el('strong','',s.title));
      content.append(el('p','',s.kind+' · '+(s.why||s.observedAt||'합성 기억 실험')));
      row.append(content,el('span','',s.state==='SYNTHETIC_READY'?'합성 예시':s.state==='CONSENT_REQUIRED'?'동의 전':s.state==='SYNTHETIC_NOT_LOADED'?'예시 미적재':'연결 미확인'));
      list.append(row);
    }
    pane.append(list);
  }
  function renderMap(pane){
    pane.append(panelTitle('기억 지도','기억·결정·목표·프로젝트 관계의 첫 단계입니다. 실제 개인 그래프가 아닌 출처 연결 목록입니다.'));
    safeStatus(pane);
    const links=model.map();
    if(!links.length){pane.append(empty('사용자가 승인한 합성 기억의 연결이 없습니다. 동의 후 예시 기록을 불러오세요.'));return;}
    const list=el('div','ava-p0-panel');
    for(const m of links){
      const row=el('div','ava-p0-relation');
      row.append(el('strong','',m.title),document.createTextNode('  →  '+(m.linkedTo.endsWith('PHONE')?'휴대폰 기록 예시':'PC 기록 예시')));
      row.append(el('small','',' · '+m.sourceRef));
      list.append(row);
    }
    pane.append(list,empty('사용자가 확인한 관계만 실제 기억 지도에 반영합니다. 합성 예시의 관계는 개인적 사실이 아닙니다.'));
  }
  function render(){
    const s=model.snapshot();
    consent.checked=s.consent.memory;
    seed.disabled=!s.consent.memory||s.memories.length>0;
    revoke.disabled=!s.consent.memory;
    for(const [id] of tabs){
      const button=tabsElement.querySelector('#ava-p0-tab-'+id);
      button.setAttribute('aria-selected',String(state.tab===id));
      button.tabIndex=state.tab===id?0:-1;
    }
    body.replaceChildren();
    const panel=el('div','ava-p0-panel');
    if(state.tab==='ask')renderAsk(panel);
    if(state.tab==='memory')renderMemories(panel);
    if(state.tab==='about')renderAbout(panel);
    if(state.tab==='sources')renderSources(panel);
    if(state.tab==='map')renderMap(panel);
    body.append(panel);
  }
  function invalidate(message){
    state.lastSearch=null;
    state.status=message;
    state.statusKind='PENDING';
  }
  function show(){
    if(state.open)return;
    const oldR6=document.getElementById('r6-inline-pane');
    if(oldR6&&!oldR6.hidden){
      const back=document.getElementById('r6-pane-back');
      if(back){back.click();setTimeout(show,100);return;}
    }
    state.hiddenBefore=Array.from(main.querySelectorAll(':scope > section.panel'),x=>({element:x,hidden:x.hidden}));
    for(const item of state.hiddenBefore)item.element.hidden=item.element!==chat;
    chat.hidden=false;
    chat.classList.add('r6-tool-active');
    root.hidden=false;
    state.open=true;
    scroll.scrollTop=0;
    app.classList.remove('menu-open');
    const backdrop=document.getElementById('sidebar-backdrop');if(backdrop)backdrop.hidden=true;
    render();
  }
  function closeAva(){
    if(!state.open)return;
    root.hidden=true;state.open=false;
    if(document.getElementById('r6-inline-pane')?.hidden!==false)chat.classList.remove('r6-tool-active');
    if(state.hiddenBefore){
      for(const item of state.hiddenBefore)item.element.hidden=item.hidden;
      state.hiddenBefore=null;
    }
  }
  root.addEventListener('click',event=>{
    const b=event.target.closest('button[data-op]');
    if(!b||!root.contains(b))return;
    const op=b.dataset.op,id=b.dataset.id;
    try {
      if(op==='close'){closeAva();return;}
      if(op==='tab'){state.tab=id;render();return;}
      if(op==='seed'){model.seed();invalidate('합성 기억 3건을 불러왔습니다. 실제 개인정보는 사용하지 않습니다.');}
      if(op==='revoke'){model.consentMemory(false);state.editingId=null;invalidate('합성 기억 사용이 중지됐습니다. 실제 서버 기록 삭제를 의미하지 않습니다.');}
      if(op==='example-question'){state.tab='ask';state.question=b.dataset.question||'';render();return;}
      if(op==='edit'){state.editingId=id;render();return;}
      if(op==='cancel-edit'){state.editingId=null;render();return;}
      if(op==='save-correction'){
        const text=root.querySelector('#ava-p0-edit-text')?.value||'';
        model.correct(id,text);state.editingId=null;
        invalidate('기억 정정으로 이전 답변이 무효화됐습니다. 재승인 전에는 검색되지 않습니다.');
      }
      if(op==='approve'){model.approve(id);invalidate('정정된 합성 기억을 재승인했습니다. 새 질문을 입력해 확인해 주세요.');}
      if(op==='disable'){model.revokeItem(id);invalidate('선택한 합성 기억을 사용 중지하고 검색·지도에서 제외했습니다.');}
      if(op==='profile-confirm'){model.setProfile(id,'CONFIRMED_DEMO');info('프로필 후보를 시연에서 확인했습니다. 실제 고객 프로필에 저장된 것은 아닙니다.','PENDING');}
      if(op==='profile-reject'){model.setProfile(id,'REJECTED_DEMO');info('프로필 후보를 시연에서 거부했습니다.','PENDING');}
      render();
    }catch(err){info('요청이 처리되지 않았습니다: '+(err?.message||'오류'),'DENIED');render();}
  });
  consent.addEventListener('change',()=>{
    try{
      model.consentMemory(consent.checked);
      invalidate(consent.checked?'합성 기억 검색 동의를 켰습니다. 예시 기록은 아직 불러오지 않았습니다.':'기억 사용 동의를 철회하고 합성 상태를 초기화했습니다.');
      state.editingId=null;
    }catch(err){info(String(err.message),'DENIED');}
    render();
  });
  body.addEventListener('submit',event=>{
    if(event.target.id!=='ava-p0-search')return;
    event.preventDefault();
    state.question=body.querySelector('#ava-p0-question')?.value||'';
    state.device=body.querySelector('#ava-p0-device')?.value||'ALL';
    state.lastSearch=model.search(state.question,{device:state.device});
    const r=state.lastSearch;
    if(r.status==='GROUNDED_SYNTHETIC')info('합성 기억 '+r.results.length+'건을 근거로 찾았습니다. 실제 사용자 기록은 조회하지 않았습니다.',r.status);
    else if(r.status==='NO_GROUNDED_ANSWER')info('허용된 합성 기록에서 근거를 찾지 못했습니다. 추측으로 답변하지 않습니다.',r.status);
    else info('검색할 수 없습니다: '+r.reason,r.status);
    render();
  });
  tabsElement.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
    const current=tabs.findIndex(x=>x[0]===state.tab);
    const offset=event.key==='ArrowRight'?1:-1;
    state.tab=tabs[(current+offset+tabs.length)%tabs.length][0];
    event.preventDefault();render();
    tabsElement.querySelector('#ava-p0-tab-'+state.tab)?.focus();
  });
  // Intercept only AVA navigation. Every other existing app control stays owned
  // by the current customer UI and R6 workspace implementation.
  window.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    const avaLink=target.closest('[data-section="ava"]');
    if(avaLink){
      event.preventDefault();event.stopPropagation();show();return;
    }
    if(!state.open||root.contains(target))return;
    if(target.closest('[data-section],a[href],#new-chat,#project-new-chat,#open-settings,[data-open-project],[data-open-chat]')){
      closeAva();
    }
  },true);
  window.addEventListener('popstate',()=>{
    if(state.open)closeAva();
  });
})();
