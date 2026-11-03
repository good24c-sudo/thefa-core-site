'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const hostedCustomer = location.protocol === 'https:' &&
    (location.hostname === 'app.thefacore.com' || location.hostname.endsWith('.vercel.app'));
  const durableService=document.documentElement.dataset.liveService==='deepseek';
  const isDeepSeek=()=>model.workspace.capabilities?.modelProvider==='DEEPSEEK_API';
  const hasChatAi=()=>Boolean(model.workspace.capabilities?.chatAiReady||model.workspace.capabilities?.localAiCanaryAvailable);
  const accountRequired=()=>Boolean(durableService&&model.workspace.capabilities?.accountRequired);

  const id = key => document.getElementById(key);
  const ROUTES = { AUTO:'자동 선택',LOCAL_FIRST:'로컬 우선',LOCAL_ONLY:'로컬만',CLOUD_FIRST:'클라우드 우선' };
  const blank = () => ({
    contract:'THEFA_CUSTOMER_CHAT_V2',persistence:'PREVIEW_MEMORY_ONLY',projects:[],conversations:[],
    settings:{aiTier:'AUTO',route:'AUTO',ava:{version:'AVA_V1_DRAFT',role:'기획',
      memoryScope:'선택한 프로젝트만',permissions:'읽기·초안',budget:'유료 실행 전 승인',instructions:''}},
    capabilities:{chatAiReady:false,localPcPaired:false,localAiState:'NOT_CONNECTED',
      actualCloudCost:null,verifiedCostSaving:null,avaExecutionReady:false,localAiCanaryAvailable:false}
  });
  const model = { workspace:blank(),view:'chat', projectId:null,conversationId:null,
    conversation:null,serverConnected:false,preview:true,hostedBlocked:false,busy:false,search:'',pendingRequestIds:new Map(),account:null };
  let avaEditRevision=0;
  const factory = (tag,cls,text) => { const e=document.createElement(tag);
    if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e; };
  const empty=(text)=>factory('p','muted',text);
  const uuid=()=>{
    if(typeof crypto!=='undefined' && typeof crypto.randomUUID==='function')
      return crypto.randomUUID();
    // LAN HTTP is not a secure context, so randomUUID() may be hidden.
    // getRandomValues remains available, and IDs are metadata/idempotency only;
    // guest authority comes exclusively from an HttpOnly HMAC-signed server cookie.
    if(typeof crypto==='undefined'||typeof crypto.getRandomValues!=='function')
      throw Error('SECURE_RANDOM_NOT_AVAILABLE');
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
    const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  };
  const t=()=>new Date().toISOString();
  function notify(text){const x=id('toast');x.textContent=text;x.hidden=false;
    clearTimeout(notify.timer);notify.timer=setTimeout(()=>{x.hidden=true;},4000);}
  function closeNav(){id('app').classList.remove('menu-open');id('sidebar-backdrop').hidden=true;}
  function openNav(){id('app').classList.add('menu-open');id('sidebar-backdrop').hidden=false;}
  function countDialogs(){return model.workspace.conversations.length;}
  function currentProject(){return model.workspace.projects.find(p=>p.id===model.projectId)||null;}
  function projectName(projectId){return model.workspace.projects.find(p=>p.id===projectId)?.title||'일반 대화';}
  function currentConversation(){return model.conversation||model.workspace.conversations.find(c=>c.id===model.conversationId);}
  const TIER_LABELS={AUTO:'자동',STANDARD:'일반 답변',EXPERT:'전문 분석',ULTRA:'정밀 검토'};
  function modeSupport(){
    const caps=model.workspace.capabilities||{};
    return {routes:caps.supportedRoutes||(caps.localAiCanaryAvailable?['AUTO','LOCAL_FIRST','LOCAL_ONLY']:['AUTO']),
      tiers:caps.supportedAiTiers||(caps.localAiCanaryAvailable?['AUTO','STANDARD']:['AUTO'])};
  }
  function syncMode(){
    const settings=model.workspace.settings||{},route=ROUTES[settings.route]||'자동 선택';
    id('mode-label').textContent=route+(settings.aiTier&&settings.aiTier!=='AUTO'?' · '+TIER_LABELS[settings.aiTier]:'');
    id('mode-picker').disabled=model.hostedBlocked||model.busy;
  }
  function configureModeSelects(routeId,tierId){
    const available=modeSupport();
    for(const option of id(routeId).options){
      option.disabled=!available.routes.includes(option.value);
      option.textContent=(ROUTES[option.value]||option.value)+(option.disabled?' · 연결 필요':'');
    }
    for(const option of id(tierId).options){
      option.disabled=!available.tiers.includes(option.value);
      option.textContent=(TIER_LABELS[option.value]||option.value)+(option.disabled?' · 준비 중':'');
    }
    id(routeId).value=model.workspace.settings?.route||'AUTO';
    id(tierId).value=model.workspace.settings?.aiTier||'AUTO';
  }
  function closeModePanel(restoreFocus=false){
    id('composer-mode-panel').hidden=true;id('mode-picker').setAttribute('aria-expanded','false');
    if(restoreFocus)id('mode-picker').focus({preventScroll:true});
  }
  function openModePanel(){
    if(model.busy||model.hostedBlocked){notify('현재 작업이 끝난 뒤 AI 선택을 변경해 주세요.');return;}
    configureModeSelects('composer-route','composer-tier');
    const engine=model.workspace.capabilities?.modelName;
    id('composer-mode-engine').textContent=engine?(isDeepSeek()?'THE FA Core AI 연결됨':'현재 응답 엔진: '+engine):'아직 응답할 AI가 연결되지 않았습니다.';
    id('composer-mode-status').textContent=isDeepSeek()
      ?'자동·일반 답변을 사용할 수 있습니다. 로컬·전문·정밀 기능은 연결 후 선택할 수 있습니다.'
      :'연결된 자원만 선택할 수 있습니다. 미연결 항목은 실행되지 않습니다.';
    id('composer-mode-panel').hidden=false;id('mode-picker').setAttribute('aria-expanded','true');
    id('composer-route').focus({preventScroll:true});
  }
  function setBlockedForCustomerProduction(error){
    model.hostedBlocked=true;
    id('connection-badge').classList.remove('ready');
    id('connection-text').textContent='대화 저장 연결 불가';
    id('account-status').textContent='로그인·연결 확인 중';
    id('free-usage').textContent='연결 후 사용량 확인';
    id('readiness-notice').textContent='고객별 저장소 연결을 확인하지 못했습니다. 입력한 대화가 사라지지 않도록 새 대화와 저장을 차단했습니다. 다시 시도할 수 있습니다.';
    const retry=document.createElement('button');
    retry.type='button';retry.className='text-button';retry.textContent='연결 다시 시도';
    retry.addEventListener('click',init);
    id('readiness-notice').append(retry);
    for(const control of ['new-chat','new-project','chat-input','send-button','project-new-chat',
      'save-project','save-ava']){
      const element=id(control);if(element)element.disabled=true;
    }
  }
  function releaseHostedBlock(){
    model.hostedBlocked=false;
    for(const control of ['new-chat','new-project','chat-input','project-new-chat','save-project','save-ava']){
      const element=id(control);if(element)element.disabled=false;
    }
  }
  function setConnected(isReady){
    model.serverConnected=isReady;model.preview=!isReady;
    const x=id('connection-badge');x.classList.toggle('ready',isReady);
    const canary=Boolean(isReady&&model.workspace.capabilities?.localAiCanaryAvailable);
    id('connection-text').textContent=canary?'실제 로컬 AI 시험':isReady?'고객 작업공간':'미리보기';
    id('account-status').textContent=isReady?'계정 연결 확인 중':'연결 확인 중';
    id('readiness-notice').textContent=canary
      ?'로컬 AI 시험 연결입니다. 고객 서비스는 로그인 후 이용하며, 실제 제공 범위는 연결 상태를 확인해 주세요.'
      :isReady
        ?'고객 저장소와 연결됐습니다. 고객 간 격리 검증 및 실제 AI 실행·PC 연결은 별도 확인이 필요합니다.'
        :'고객용 화면 미리보기입니다. 프로젝트·대화는 이 브라우저에서만 유지되며 새로고침하면 사라집니다. 실제 AI 답변과 PC 제어는 실행되지 않습니다.';
    id('composer-helper').textContent=canary
      ?'실제 Ollama 응답입니다. 시간당 최대 2회 체험 가능하며 공식 클라우드 영수증은 아닙니다.'
      :isReady
        ?'실제 AI 실행 연결 전입니다. 메시지는 답변 요청이 아닌 초안으로 저장됩니다.'
        :'미리보기 초안입니다. 실제 AI 호출·비용 발생·서버 저장은 없습니다.';
    if(durableService){
      id('connection-text').textContent=isReady?'작업공간 연결됨':'서비스 연결 확인 중';
      id('account-status').textContent=isReady?'계정·사용량 확인 중':'로그인·연결 확인 중';
      id('readiness-notice').textContent=isReady
        ?'로그인과 사용량 확인 후 고객 계정의 대화를 이어갈 수 있습니다. 기존 사용량은 초기화되지 않습니다.'
        :'대화 저장소에 연결하지 못했습니다. 연결을 복구한 뒤 다시 이용해 주세요.';
      id('composer-helper').textContent=isReady
        ?'대화 내용은 답변 생성을 위해 전송됩니다.'
        :'저장소 연결을 확인하기 전까지 전송을 중단합니다.';
      document.title='THE FA Core · AI 작업공간';
      const label=document.querySelector('.guest-label');if(label)label.textContent='THE FA CORE · 로그인 후 시작';
      const welcome=document.querySelector('#chat-welcome > p:not(.overline)');
      if(welcome)welcome.textContent='질문하고, 함께 정리하고, 저장된 대화를 이어가세요.';
      const disclaimer=document.querySelector('.disclaimer');
      if(disclaimer)disclaimer.textContent='로그인 후 고객당 AI 답변 10회 · 기존 사용량 유지 · 중요한 답변은 확인해 주세요.';
      syncMode();
      if(!id('clear-saved-history')){
        const clear=factory('button','bottom-action','대화·프로젝트 기록 지우기');
        clear.id='clear-saved-history';clear.type='button';
        clear.addEventListener('click',async()=>{
          if(model.busy){notify('답변이 끝난 후 기록을 지울 수 있습니다.');return;}
          if(!confirm((model.account?'내 계정':'이 브라우저')+'의 대화와 프로젝트 기록을 서버에서 지울까요? 복구할 수 없습니다.'))return;
          try{await request('/api/customer/clear',{method:'POST',body:'{}'});
            model.conversationId=null;model.conversation=null;model.projectId=null;
            await init();notify('저장된 대화와 프로젝트 기록을 지웠습니다.');}
          catch{notify('기록을 지우지 못했습니다. 잠시 후 다시 시도해 주세요.');}
        });
        document.querySelector('.sidebar-bottom').insertBefore(clear,id('account-actions')||document.querySelector('.account-row'));
      }
    }
  }
  async function request(path,options={}){
    const init={credentials:'same-origin',cache:'no-store',...options};
    if(init.body!==undefined)init.headers={'content-type':'application/json',...(init.headers||{})};
    const response=await fetch(path,init);
    let value;try{value=await response.json();}catch{value={code:'RESPONSE_INVALID'};}
    if(response.status===401){const error=new Error('AUTH_REQUIRED');error.status=401;throw error;}
    if(!response.ok){const error=new Error(value.code||value.error||'REQUEST_FAILED');error.status=response.status;throw error;}
    return value;
  }
  async function init(){
    if(durableService)await loadAccount();
    try{
      const workspace=await request('/api/customer/workspace');
      if(!workspace||workspace.contract!=='THEFA_CUSTOMER_CHAT_V2')throw Error('CONTRACT_MISMATCH');
      model.workspace=workspace;
      releaseHostedBlock();
      setConnected(true);
      renderAccount();
    }catch(error){
      if(error.message==='AUTH_REQUIRED'&&!durableService)return;
      model.workspace=blank();setConnected(false);
      if(hostedCustomer||durableService)model.hostedBlocked=true;
    }
    syncMode();renderAll();switchView('chat');
    if(model.hostedBlocked)setBlockedForCustomerProduction();
    if(durableService&&model.serverConnected&&!accountRequired()&&model.workspace.conversations.length)
      await openChat(model.workspace.conversations[0].id);
    try{const pending=sessionStorage.getItem('thefa_core_pending_prompt');
      if(pending){id('chat-input').value=pending.slice(0,4000);id('send-button').disabled=model.hostedBlocked;}}
    catch{/* The typed draft still works when browser storage is disabled. */}
  }
  async function loadAccount(){
    try{
      const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
      const session=await response.json();
      model.account=response.ok&&session.authenticated?session.user:null;
      if(!response.ok){
        id('account-login').textContent='다시 로그인';id('account-logout').hidden=false;
      }
    }catch{model.account=null;}
  }
  function renderAccount(){
    if(!durableService)return;
    const user=model.account;
    const employee=Boolean(user&&model.workspace.account?.memberType==='EMPLOYEE'&&model.workspace.allowance?.unlimited===true);
    id('account-actions').hidden=Boolean(user);
    id('account-profile').hidden=!user;
    id('account-login').hidden=Boolean(user);
    id('account-logout').hidden=!user&&id('account-login').textContent!=='다시 로그인';
    id('account-name').textContent=user?user.displayName:'나의 작업공간';
    id('account-kind').textContent=user?(employee?'임직원':'계정'):'로그인 필요';
    if(user){
      id('account-status').textContent='내 계정 · 대화 저장됨';
      document.querySelector('.guest-label').textContent='MY CORE · 나의 작업공간';
      id('readiness-notice').textContent='로그인한 계정의 대화와 프로젝트를 불러왔습니다. 같은 계정으로 다시 이어갈 수 있습니다.';
    }
    if(accountRequired()){
      const usage=model.workspace.allowance;
      const left=Number.isInteger(usage?.remaining)&&usage.remaining>=0&&usage.remaining<=10?usage.remaining:null;
      id('free-usage').textContent=!user?'로그인 후 사용량 확인':employee?'무제한 이용':left===null?'사용량 확인 중':left+'/10회 남음';
      const subscription=model.workspace.subscription;
      for(const planId of ['standard','pro']){
        id(planId+'-usage').textContent=!user?'로그인 후 확인':subscription?.planId===planId&&
          Number.isFinite(subscription.remainingPercent)?subscription.remainingPercent+'% 남음':'미구독';
      }
      if(!user)id('connection-text').textContent='로그인 후 이용';
      if(user)id('account-status').textContent=employee?'더파 임직원 · 무제한 이용':left===null?'사용량 확인 중':'무료 AI 답변 '+left+' / 10회 남음';
      document.querySelector('.guest-label').textContent=user?'MY CORE · 나의 작업공간':'THE FA CORE · 나의 AI 작업공간';
      id('readiness-notice').textContent=user
        ?(employee?'인증된 더파 임직원 계정입니다. 무료 답변 횟수 제한 없이 이용하며, 보안·전체 비용 보호는 유지됩니다.':left===null?'계정의 기존 사용량을 확인하고 있습니다. 확인 전에는 남은 횟수를 표시하지 않습니다.':usage?.planRequired?'고객당 무료 AI 답변 10회를 모두 사용했습니다. 계속 이용하려면 확인된 유료 이용 권한이 필요합니다. 현재 결제는 연결되지 않았습니다.':'고객당 AI 답변 10회 · 기존 사용량을 반영해 현재 '+left+'회 남았습니다.')
        :'로그인 후 고객당 AI 답변 10회를 이용할 수 있습니다. 기존 사용량을 이어서 적용합니다.';
      id('composer-helper').textContent=user?'대화 내용은 답변 생성을 위해 전송됩니다.':'AI 답변은 로그인과 사용량 확인 후 이용할 수 있습니다.';
      document.querySelector('.disclaimer').textContent=employee?'더파 임직원 무제한 이용 · 보안·전체 비용 보호 적용 · AI 답변은 확인해 주세요.':'고객당 무료 AI 답변 10회 · 기존 사용량 유지 · AI 답변은 확인해 주세요.';
      const welcome=document.querySelector('#chat-welcome > p:not(.overline)');
      if(welcome)welcome.textContent='생각을 정리하고, 프로젝트를 시작하고, 다음 작업을 이어가세요.';
    }
  }
  function renderAll(){
    renderSidebar();syncMode();renderConversation();renderSettings();renderAva();renderLocal();
  }
  function renderSidebar(){
    const q=model.search.trim().toLocaleLowerCase('ko-KR');
    const projectList=id('project-list');projectList.replaceChildren();
    const allProjects=model.workspace.projects.filter(p=>p.title.toLocaleLowerCase('ko-KR').includes(q));
    if(!allProjects.length)projectList.append(empty(q?'검색된 프로젝트가 없습니다.':'＋ 버튼으로 프로젝트 만들기'));
    for(const p of allProjects){
      const btn=factory('button','project-item');btn.type='button';btn.dataset.openProject=p.id;
      if(p.id===model.projectId&&model.view==='project')btn.setAttribute('aria-current','page');
      btn.append(factory('span','item-icon','▦'),factory('span','truncate',p.title));projectList.append(btn);
    }
    const list=id('chat-list');list.replaceChildren();
    const items=model.workspace.conversations.filter(c=>
      !c.archivedAt&&[c.title,c.lastMessage||'',projectName(c.projectId)].join(' ').toLocaleLowerCase('ko-KR').includes(q));
    items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    id('chat-count').textContent=model.workspace.conversations.length?String(model.workspace.conversations.length):'';
    if(!items.length)list.append(empty(q?'검색 결과가 없습니다.':'아직 대화가 없습니다.'));
    for(const c of items){
      const btn=factory('button','nav-item');btn.type='button';btn.dataset.openChat=c.id;
      if(c.id===model.conversationId&&model.view==='chat')btn.setAttribute('aria-current','page');
      btn.append(factory('span','item-icon','▤'),factory('span','truncate',c.title));list.append(btn);
    }
  }
  function switchView(view){
    closeModePanel();
    model.view=['chat','project','ava','local','settings'].includes(view)?view:'chat';
    for(const value of ['chat','project','ava','local','settings'])id(value+'-panel').hidden=value!==model.view;
    if(model.view==='project'&&!currentProject()){model.view='chat';id('project-panel').hidden=true;id('chat-panel').hidden=false;}
    if(model.view==='project')renderProject();
    if(model.view==='chat')renderConversation();
    if(model.view==='settings')renderSettings();
    if(model.view==='ava')renderAva();
    if(model.view==='local')renderLocal();
    id('breadcrumb').textContent={
      chat:currentConversation()?.title||'새 대화',
      project:currentProject()?.title||'프로젝트',ava:'나의 AVA',local:'로컬 AI · PC',settings:'AI 사용 설정'
    }[model.view];
    renderSidebar();closeNav();
    id('chat-main').focus({preventScroll:true});
  }
  async function refresh(){
    if(!model.serverConnected)return;
    model.workspace=await request('/api/customer/workspace');
    renderSidebar();renderSettings();renderAva();renderLocal();renderAccount();
  }
  function updatePreview(action,payload){
    const w=model.workspace,c=w.conversations,projects=w.projects;
    let result={};
    if(action==='project.create'){
      const p={id:'proj_'+uuid(),title:payload.title.trim(),instructions:'',createdAt:t(),updatedAt:t()};
      projects.push(p);return {project:p};
    }
    if(action==='project.update'){
      const p=projects.find(x=>x.id===payload.projectId);if(!p)throw Error('PROJECT_NOT_FOUND');
      if(payload.title!==undefined)p.title=payload.title.trim();
      if(payload.instructions!==undefined)p.instructions=payload.instructions.trim();
      return {project:p};
    }
    if(action==='conversation.create'){
      const chat={id:'chat_'+uuid(),projectId:payload.projectId||null,title:payload.title||'새 대화',
        messages:[],archivedAt:null,createdAt:t(),updatedAt:t(),messageCount:0};
      c.unshift(chat);return {conversation:chat};
    }
    if(action==='conversation.update'||action==='conversation.archive'){
      const chat=c.find(x=>x.id===payload.conversationId);if(!chat)throw Error('CONVERSATION_NOT_FOUND');
      if(action==='conversation.archive')chat.archivedAt=t();
      if(payload.title!==undefined)chat.title=payload.title.trim();
      if(payload.projectId!==undefined)chat.projectId=payload.projectId;
      chat.updatedAt=t();return {conversation:chat};
    }
    if(action==='message.draft'){
      const chat=c.find(x=>x.id===payload.conversationId);if(!chat)throw Error('CONVERSATION_NOT_FOUND');
      const msg={id:'msg_'+uuid(),role:'user',content:payload.content.trim(),createdAt:t(),
        state:'DRAFT_NOT_DISPATCHED',dispatch:'NONE',receiptId:null};
      chat.messages.push(msg);chat.messageCount=chat.messages.length;
      if(chat.title==='새 대화')chat.title=msg.content.slice(0,45);
      chat.lastMessage=msg.content.slice(0,100);chat.updatedAt=t();return {conversation:chat,message:msg};
    }
    if(action==='settings.update'){
      Object.assign(w.settings,payload);return {settings:w.settings,saved:false};
    }
    if(action==='ava.update'){
      const {expectedProfileRevision, ...draft}=payload;
      Object.assign(w.settings.ava,draft);return {ava:w.settings.ava,saved:false,executable:false};
    }
    throw Error('ACTION_NOT_ALLOWED');
  }
  function applyConfirmedMutation(name,payload,result){
    // A server-confirmed POST may succeed when the follow-up GET fails. Keep the exact receipt result.
    const w=model.workspace;
    if(name.startsWith('project.')&&result.project){
      const found=w.projects.find(item=>item.id===result.project.id);
      if(found)Object.assign(found,result.project);
      else w.projects.push(result.project);
    }
    if(name.startsWith('conversation.')&&result.conversation){
      const found=w.conversations.find(item=>item.id===result.conversation.id);
      if(found)Object.assign(found,result.conversation);
      else w.conversations.unshift(result.conversation);
    }
    if(name==='message.draft'&&result.message&&result.conversation){
      const found=w.conversations.find(item=>item.id===result.conversation.id);
      if(found)Object.assign(found,result.conversation);
      if(model.conversation?.id===result.conversation.id){
        model.conversation.messages=model.conversation.messages||[];
        if(!model.conversation.messages.some(item=>item.id===result.message.id))
          model.conversation.messages.push(result.message);
        Object.assign(model.conversation,{title:result.conversation.title,updatedAt:result.conversation.updatedAt});
      }
    }
    if(name==='settings.update'&&result.settings)w.settings=result.settings;
    if(name==='ava.update'&&result.ava){w.settings.ava=result.ava;
      if(Number.isSafeInteger(result.ava.profileRevision))avaEditRevision=result.ava.profileRevision;}
  }
  async function action(name,payload={}){
    if(model.hostedBlocked){notify('고객 저장소에 연결되지 않아 새 작업을 중단했습니다.');return null;}
    if(model.busy)return null;
    model.busy=true;
    try{
      if(!model.serverConnected)return updatePreview(name,payload);
      const key=name+'|'+JSON.stringify(payload);
      const requestId=model.pendingRequestIds.get(key)||'ui-'+uuid();
      model.pendingRequestIds.set(key,requestId);
      let result;
      try{
        result=await request('/api/customer/action',{method:'POST',
          body:JSON.stringify({action:name,payload,requestId})});
        model.pendingRequestIds.delete(key);
       }catch(error){
         if(name==='ava.update'&&error.status===409&&error.message==='AVA_PROFILE_REVISION_CONFLICT'){
           // An explicit 409 means this write did NOT commit. The current draft stays in the form.
           // Never automatically replay a mutation; a later Save makes a new request ID.
           model.pendingRequestIds.delete(key);
           showAvaCompareButton();
           notify('다른 창에서 나의 AVA가 변경되었습니다. 현재 초안은 보존됩니다.');
           return null;
         }
         // Do not replay automatically. A timed-out POST may have been committed.
        notify('요청 처리 여부를 확인하지 못했습니다. 서버 상태를 확인한 뒤 같은 요청 ID로 재시도할 수 있습니다.');
        return null;
      }
      applyConfirmedMutation(name,payload,result);
      try{await refresh();}
      catch(error){
        id('connection-text').textContent='저장됨 · 목록 동기화 지연';
        id('readiness-notice').textContent='서버가 저장을 확인했지만 목록 갱신에 실패했습니다. 같은 작업을 다시 만들지 마시고 연결을 확인해 주세요.';
      }
      return result;
    }catch(error){notify('작업을 처리하지 못했습니다: '+error.message);return null;}
    finally{model.busy=false;}
  }
  async function createProject(){
    const title=id('project-name').value.trim();
    if(!title)return;
    const r=await action('project.create',{title});
    if(!r)return;
    id('project-dialog').close();id('project-name').value='';
    model.projectId=r.project.id;model.conversationId=null;model.conversation=null;
    renderSidebar();switchView('project');
    notify(model.preview?'프로젝트 미리보기 생성 · 저장 안됨':'프로젝트 생성 완료');
  }
  async function createChat(projectId=model.projectId){
    const r=await action('conversation.create',{projectId:projectId||null});
    if(!r)return;
    model.conversationId=r.conversation.id;model.projectId=r.conversation.projectId||null;
    model.conversation={...r.conversation,messages:[]};
    if(!model.workspace.conversations.some(item=>item.id===r.conversation.id))model.workspace.conversations.unshift(r.conversation);
    renderSidebar();switchView('chat');id('chat-input').focus();
  }
  async function openChat(cid){
    model.conversationId=cid;
    const info=model.workspace.conversations.find(c=>c.id===cid);
    model.projectId=info?.projectId||null;
    if(model.serverConnected){
      try{const result=await request('/api/customer/conversations/'+encodeURIComponent(cid));
        model.conversation=result.conversation;}catch(error){notify(error.message);return;}
    }else model.conversation=info;
    switchView('chat');
  }
  function renderConversation(){
    const c=currentConversation();
    id('chat-welcome').hidden=!!c;id('conversation-header').hidden=!c;
    id('messages').replaceChildren();
    if(c){
      id('conversation-title').textContent=c.title;
      id('conversation-project').textContent=projectName(c.projectId);
      for(const msg of c.messages||[]){
        const row=factory('article','message '+(msg.role==='user'?'user':'system'));
        row.append(factory('div','message-icon',msg.role==='user'?'나':'✦'));
        const body=factory('div','message-body');
        body.append(factory('div','role',msg.role==='user'?'나':'THE FA Core'));
        body.append(factory('p','',msg.content));
        if(msg.state==='DRAFT_NOT_DISPATCHED')body.append(factory('div','message-state','초안 · 아직 AI에 전송되지 않음'));
        else if(msg.state)body.append(factory('div','message-state',{
          SENT_TO_MODEL:'전송됨',MODEL_REQUEST_PENDING:'답변 대기 중',
          MODEL_REQUEST_PAUSED:'응답 확인 필요',
          MODEL_RESPONSE_RECEIVED_UNVERIFIED:'저장됨'
        }[msg.state]||'저장됨'));
        row.append(body);id('messages').append(row);
      }
      const pane=$('.chat-flow');pane.scrollTop=pane.scrollHeight;
    }
    id('breadcrumb').textContent=c?.title||'새 대화';
    const hasInput=id('chat-input').value.trim().length>0;
    id('send-button').disabled=!hasInput||model.busy;
    id('send-button').setAttribute('aria-label',
      hasChatAi()?'질문 보내기':'메시지 초안 기록');
  }
  async function submitCanaryModelMessage(conversation,content,input){
    const requestKey='local.canary|'+conversation.id+'|'+content;
    const requestId=model.pendingRequestIds.get(requestKey)||'ui-'+uuid();
    model.pendingRequestIds.set(requestKey,requestId);
    model.busy=true;
    input.disabled=true;
    id('send-button').disabled=true;
    id('connection-text').textContent='AI 답변을 기다리는 중…';
    let result;
    try{
      result=await request('/api/customer/chat/send',{method:'POST',
        body:JSON.stringify({conversationId:conversation.id,content,requestId})});
    }catch(error){
      // A timeout could mean the model ran. Keep the same request id; never auto-replay.
      if(error.status===402){id('free-limit-dialog').showModal();model.busy=false;input.disabled=false;renderConversation();return;}
      if(error.status===401){id('start-guide').showModal();model.busy=false;input.disabled=false;renderConversation();return;}
      const message=error.status===429?'오늘의 이용 한도 또는 동시 요청 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.':
        '응답을 확인하지 못했습니다. 대화를 다시 열어 저장 상태를 확인해 주세요. 자동 재전송은 하지 않습니다.';
      notify(message);id('readiness-notice').textContent=message;
      id('connection-text').textContent='요청 상태 확인 필요';
      model.busy=false;input.disabled=false;renderConversation();
      return;
    }
    model.pendingRequestIds.delete(requestKey);
    input.value='';
    try{sessionStorage.removeItem('thefa_core_pending_prompt');}catch{}
    let readbackFailed=false;
    try{
      const completed=(await request('/api/customer/conversations/'+encodeURIComponent(conversation.id))).conversation;
      if(model.conversationId===conversation.id)model.conversation=completed;
    }catch{
      readbackFailed=true;
      const messages=[...(conversation.messages||[])];
      for(const msg of [result.userMessage,result.assistantMessage])
        if(msg&&!messages.some(x=>x.id===msg.id))messages.push(msg);
      if(model.conversationId===conversation.id)model.conversation={...conversation,messages};
    }
    try{await refresh();}catch{readbackFailed=true;}
    if(readbackFailed){
      id('connection-text').textContent='모델 답변 저장됨 · 조회 지연';
      id('readiness-notice').textContent='실제 모델 답변은 저장됐지만 읽기 동기화가 지연됩니다. 동일 요청을 반복 전송하지 마세요.';
    }
    model.busy=false;input.disabled=false;renderConversation();renderSidebar();
    if(!readbackFailed){setConnected(true);renderAccount();}
    notify(isDeepSeek()?'답변과 대화를 저장했습니다.':'실제 Ollama 모델 답변을 받았습니다. 공식 Core 작업 완료로 인정하지 않습니다.');
  }

  async function submitMessage(){
    if(model.hostedBlocked)return;
    const input=id('chat-input'),content=input.value.trim();
    if(!content||model.busy||id('send-button').disabled)return;
    if(accountRequired()&&!model.account){id('start-guide').showModal();return;}
    if(accountRequired()&&model.workspace.allowance?.planRequired){id('free-limit-dialog').showModal();return;}
    let c=currentConversation();
    if(!c){
      await createChat(model.projectId);
      c=currentConversation();
      if(!c)return;
    }
    if(model.serverConnected&&hasChatAi())
      return submitCanaryModelMessage(c,content,input);
    const r=await action('message.draft',{conversationId:c.id,content});
    if(!r)return;
    input.value='';
    let delayed=false;
    if(model.serverConnected){
      try{model.conversation=(await request('/api/customer/conversations/'+encodeURIComponent(c.id))).conversation;}
      catch(error){
        delayed=true;
        const messages=[...(c.messages||[])];
        if(!messages.some(item=>item.id===r.message.id))messages.push(r.message);
        model.conversation={...c,messages};
      }
    }else model.conversation=model.workspace.conversations.find(x=>x.id===c.id);
    if(model.serverConnected)try{await refresh();}
    catch(error){delayed=true;}
    if(delayed){
      id('connection-text').textContent='저장됨 · 목록 동기화 지연';
      id('readiness-notice').textContent='메시지는 저장됐지만 목록 갱신이 지연되고 있습니다. 동일한 요청을 다시 보내지 마시고 연결 상태를 확인해 주세요.';
    }
    renderConversation();renderSidebar();
    notify('메시지를 초안으로 저장했습니다. 실제 AI 호출은 하지 않았습니다.');
  }
  function renderProject(){
    const p=currentProject();if(!p)return;
    id('project-heading').textContent=p.title;
    id('project-subtitle').textContent='이 프로젝트의 대화는 별도로 묶이고 지침을 함께 관리합니다.';
    id('project-instructions').value=p.instructions||'';
    const list=id('project-chats');list.replaceChildren();
    const items=model.workspace.conversations.filter(c=>c.projectId===p.id&&!c.archivedAt);
    if(!items.length)list.append(empty('이 프로젝트에 대화가 없습니다. 새 대화부터 시작하세요.'));
    for(const c of items){const button=factory('button','',c.title);button.type='button';
      button.dataset.openChat=c.id;list.append(button);}
  }
  function showAvaCompareButton(){
    if(id('ava-compare-conflict'))return;
    const button=factory('button','button','최신 AVA 설정과 비교');
    button.id='ava-compare-conflict';button.type='button';
    button.addEventListener('click',compareAvaConflict);
    id('ava-form').append(button);
  }
  async function compareAvaConflict(){
    if(id('ava-conflict-dialog'))return;
    const trigger=id('ava-compare-conflict');
    if(trigger)trigger.disabled=true;
    try{
      const latestWorkspace=await request('/api/customer/workspace');
      const latest=latestWorkspace?.settings?.ava;
      if(latestWorkspace?.contract!=='THEFA_CUSTOMER_CHAT_V2'||!latest||
         !Number.isSafeInteger(latest.profileRevision)||latest.profileRevision<0)
         throw Error('AVA_LATEST_REVISION_UNAVAILABLE');
      const dialog=factory('dialog','move-dialog');dialog.id='ava-conflict-dialog';
      dialog.style.maxWidth='min(680px, calc(100vw - 32px))';
      const body=factory('div','dialog-form');
      body.append(factory('h2','','나의 AVA 설정 충돌 확인'),
       factory('p','','다른 창의 최신 설정과 현재 초안을 비교하세요. 버튼 선택만으로 서버에 다시 저장하지 않습니다.'));
      const latestValues={role:latest.role,memoryScope:latest.memoryScope,
        permissions:latest.permissions,budget:latest.budget,instructions:latest.instructions};
      const draftValues={role:id('ava-role').value,memoryScope:id('ava-memory').value,
        permissions:id('ava-permissions').value,budget:id('ava-budget').value,
        instructions:id('ava-instructions').value};
      function addPreview(title,values){
        body.append(factory('h3','',title));
        const pre=factory('pre','',JSON.stringify(values,null,2));
        pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';
        body.append(pre);
      }
      addPreview('다른 창에서 저장한 최신 설정',latestValues);
      addPreview('현재 화면에 입력한 초안',draftValues);
      const actions=factory('div','dialog-actions');actions.style.flexWrap='wrap';
      const useLatest=factory('button','button','최신 설정 사용');
      useLatest.id='ava-use-latest';useLatest.type='button';
      const keep=factory('button','button primary','내 초안 유지 · 재저장 준비');
      keep.id='ava-keep-draft';keep.type='button';
      const cancel=factory('button','button','취소');cancel.type='button';
      cancel.addEventListener('click',()=>dialog.close());
      const resolve=useNew=>{
        model.workspace.settings.ava={...latest};
        avaEditRevision=latest.profileRevision;
        if(useNew)renderAva();
        id('ava-compare-conflict')?.remove();
        dialog.close();
        notify(useNew?'최신 AVA를 불러왔습니다.':'초안을 유지했습니다. 확인 후 저장 버튼을 누르세요.');
      };
      useLatest.addEventListener('click',()=>resolve(true));
      keep.addEventListener('click',()=>resolve(false));
      actions.append(useLatest,keep,cancel);body.append(actions);dialog.append(body);
      dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);
      dialog.showModal();
    }catch(error){
      notify('최신 AVA 설정을 확인할 수 없습니다. 입력한 초안은 그대로 보존합니다.');
    }finally{if(trigger?.isConnected)trigger.disabled=false;}
  }
  function renderAva(){
    const ava=model.workspace.settings?.ava||{};
    avaEditRevision=Number.isSafeInteger(ava.profileRevision)&&ava.profileRevision>=0?ava.profileRevision:0;
    id('ava-role').value=ava.role||'기획';
    id('ava-memory').value=ava.memoryScope||'선택한 프로젝트만';
    id('ava-permissions').value=ava.permissions||'읽기·초안';
    id('ava-budget').value=ava.budget||'유료 실행 전 승인';
    id('ava-instructions').value=ava.instructions||'';
  }
  function renderLocal(){
    const cap=model.workspace.capabilities||{};
    id('local-status').textContent=cap.localPcPaired?'연결 확인됨':'미연결';
    id('cost-status').textContent=typeof cap.actualCloudCost==='number'?'₩'+cap.actualCloudCost.toLocaleString('ko-KR'):'측정 전';
    id('savings-status').textContent=typeof cap.verifiedCostSaving==='number'?'₩'+cap.verifiedCostSaving.toLocaleString('ko-KR'):'측정 전';
  }
  function renderSettings(){
    configureModeSelects('routing-setting','tier-setting');
  }
  function changeProjectDialog(){
    const chat=currentConversation();if(!chat)return;
    const dialog=document.createElement('dialog');
    dialog.className='move-dialog';
    const form=factory('form','dialog-form');form.method='dialog';
    const top=factory('div','dialog-top');top.append(factory('h2','','프로젝트 이동'));
    const close=factory('button','icon-button','✕');close.type='button';close.setAttribute('aria-label','닫기');close.addEventListener('click',()=>dialog.close());top.append(close);form.append(top);
    const label=factory('label','','이동할 프로젝트');label.htmlFor='move-to-project';form.append(label);
    const sel=factory('select','');sel.id='move-to-project';
    const general=factory('option','','일반 대화');general.value='';sel.append(general);
    for(const p of model.workspace.projects){const option=factory('option','',p.title);option.value=p.id;sel.append(option);}
    sel.value=chat.projectId||'';form.append(sel);
    const actions=factory('div','dialog-actions');
    const cancel=factory('button','button','취소');cancel.type='button';cancel.addEventListener('click',()=>dialog.close());
    const save=factory('button','button primary','이동');save.type='submit';actions.append(cancel,save);form.append(actions);
    form.addEventListener('submit',async event=>{
      event.preventDefault();const result=await action('conversation.update',{conversationId:chat.id,projectId:sel.value||null});
      if(!result)return;model.projectId=sel.value||null;if(model.conversation)model.conversation.projectId=model.projectId;
      dialog.close();renderConversation();renderSidebar();notify('대화의 프로젝트 분류를 변경했습니다.');
    });
    dialog.append(form);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  }
  function renameProjectDialog(){
    const project=currentProject();if(!project)return;
    const dialog=document.createElement('dialog'),form=factory('form','dialog-form');
    form.append(factory('h2','','프로젝트 이름 변경'));
    const input=factory('input');input.type='text';input.maxLength=80;input.required=true;input.value=project.title;form.append(input);
    const buttons=factory('div','dialog-actions');
    const cancel=factory('button','button','취소');cancel.type='button';cancel.addEventListener('click',()=>dialog.close());
    const save=factory('button','button primary','저장');save.type='submit';buttons.append(cancel,save);form.append(buttons);
    form.addEventListener('submit',async event=>{
      event.preventDefault();const result=await action('project.update',{projectId:project.id,title:input.value});
      if(!result)return;dialog.close();renderProject();renderSidebar();id('breadcrumb').textContent=result.project.title;
    });
    dialog.append(form);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();input.focus();
  }
  function renameConversationDialog(){
    const chat=currentConversation();if(!chat)return;
    const dialog=document.createElement('dialog');const form=factory('form','dialog-form');
    const title=factory('h2','','대화 이름 변경');form.append(title);
    const input=factory('input');input.maxLength=100;input.required=true;input.value=chat.title;form.append(input);
    const buttons=factory('div','dialog-actions');const cancel=factory('button','button','취소');
    cancel.type='button';cancel.addEventListener('click',()=>dialog.close());
    const save=factory('button','button primary','저장');save.type='submit';buttons.append(cancel,save);form.append(buttons);
    form.addEventListener('submit',async e=>{e.preventDefault();const r=await action('conversation.update',{conversationId:chat.id,title:input.value});
      if(!r)return;if(model.conversation)model.conversation.title=r.conversation.title;
      dialog.close();renderConversation();renderSidebar();});
    dialog.append(form);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();input.focus();
  }

  id('new-chat').addEventListener('click',()=>createChat(null));
  id('new-project').addEventListener('click',()=>{id('project-dialog').showModal();id('project-name').focus();});
  id('cancel-project').addEventListener('click',()=>id('project-dialog').close());
  id('close-project-dialog').addEventListener('click',()=>id('project-dialog').close());
  id('create-project-form').addEventListener('submit',e=>{e.preventDefault();createProject();});
  id('workspace-search').addEventListener('input',event=>{model.search=event.target.value;renderSidebar();});
  id('project-list').addEventListener('click',event=>{const btn=event.target.closest('[data-open-project]');
    if(!btn)return;model.projectId=btn.dataset.openProject;model.conversationId=null;model.conversation=null;switchView('project');});
  id('chat-list').addEventListener('click',event=>{const btn=event.target.closest('[data-open-chat]');
    if(btn)openChat(btn.dataset.openChat);});
  id('project-chats').addEventListener('click',event=>{const btn=event.target.closest('[data-open-chat]');
    if(btn)openChat(btn.dataset.openChat);});
  id('project-new-chat').addEventListener('click',()=>createChat(model.projectId));
  id('save-project').addEventListener('click',async()=>{
    if(!model.projectId)return;
    const r=await action('project.update',{projectId:model.projectId,instructions:id('project-instructions').value});
    if(r){renderProject();notify(model.preview?'프로젝트 지침 초안 · 새로고침 시 삭제':'프로젝트 지침을 저장했습니다.');}
  });
  id('chat-form').addEventListener('submit',event=>{event.preventDefault();submitMessage();});
  id('chat-input').addEventListener('input',()=>{id('send-button').disabled=!id('chat-input').value.trim()||model.busy;});
  id('chat-input').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();submitMessage();}
  });
  id('rename-chat').addEventListener('click',renameConversationDialog);
  id('rename-project').addEventListener('click',renameProjectDialog);
  id('archive-chat').addEventListener('click',async()=>{
    const chat=currentConversation();if(!chat||!confirm('이 대화방을 보관하시겠습니까?'))return;
    const result=await action('conversation.archive',{conversationId:chat.id});if(!result)return;
    model.conversation=null;model.conversationId=null;model.projectId=null;
    model.workspace.conversations=model.workspace.conversations.filter(x=>x.id!==chat.id&&!x.archivedAt);
    switchView('chat');notify('대화방을 보관했습니다.');
  });
  id('move-chat').addEventListener('click',changeProjectDialog);
  id('mode-picker').addEventListener('click',()=>{
    if(id('composer-mode-panel').hidden)openModePanel();else closeModePanel(true);
  });
  id('close-mode-panel').addEventListener('click',()=>closeModePanel(true));
  id('apply-composer-mode').addEventListener('click',async()=>{
    if(model.busy)return;
    const route=id('composer-route').value,aiTier=id('composer-tier').value,available=modeSupport();
    if(!available.routes.includes(route)||!available.tiers.includes(aiTier)){
      id('composer-mode-status').textContent='선택한 기능이 아직 연결되지 않았습니다. 사용 가능한 항목을 선택해 주세요.';return;
    }
    const apply=id('apply-composer-mode');apply.disabled=true;
    try{
      const result=await action('settings.update',{route,aiTier});
      if(!result){id('composer-mode-status').textContent='선택을 저장하지 못했습니다. 대화 내용은 유지됩니다. 다시 시도해 주세요.';return;}
      syncMode();closeModePanel();id('chat-input').focus({preventScroll:true});
      notify(model.preview?'AI 선택 미리보기 · 저장 안 됨':'AI 선택을 저장했습니다. 다음 질문에 적용됩니다.');
    }finally{apply.disabled=false;}
  });
  document.addEventListener('pointerdown',event=>{
    if(!id('mode-selector').contains(event.target))closeModePanel();
  });
  id('mode-selector').addEventListener('focusout',event=>{
    if(event.relatedTarget&&!id('mode-selector').contains(event.relatedTarget))closeModePanel();
  });
  id('open-settings').addEventListener('click',()=>switchView('settings'));
  id('attachment-info').addEventListener('click',()=>notify('파일 첨부는 고급 작업실에서 준비 상태를 확인하세요. 검증 전 파일 업로드는 실행하지 않습니다.'));
  document.querySelectorAll('[data-suggest]').forEach(b=>b.addEventListener('click',()=>{
    id('chat-input').value=b.dataset.suggest;id('send-button').disabled=false;id('chat-input').focus();
  }));
  document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.section)));
  id('settings-form').addEventListener('submit',async e=>{
    e.preventDefault();const r=await action('settings.update',{route:id('routing-setting').value,aiTier:id('tier-setting').value});
    if(r){syncMode();notify(model.preview?'설정 미리보기 · 저장 안됨':'AI 실행 설정을 저장했습니다. 실제 연결은 별도입니다.');}
  });
  id('ava-form').addEventListener('submit',async e=>{
    e.preventDefault();const r=await action('ava.update',{
      expectedProfileRevision:avaEditRevision,role:id('ava-role').value,memoryScope:id('ava-memory').value,permissions:id('ava-permissions').value,
      budget:id('ava-budget').value,instructions:id('ava-instructions').value});
    if(r)notify(model.preview?'AVA 설정 초안 · 저장 안됨':'AVA 설정 초안을 저장했습니다. AI 실행 권한은 주어지지 않았습니다.');
  });
  id('open-sidebar').addEventListener('click',openNav);
  id('close-sidebar').addEventListener('click',closeNav);
  id('sidebar-backdrop').addEventListener('click',closeNav);
  id('account-login').addEventListener('click',event=>{
    if(model.busy){event.preventDefault();notify('답변이 끝난 후 로그인해 주세요.');}
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>id(button.dataset.closeDialog).close()));
  document.querySelectorAll('[data-keep-prompt],#account-login,.signup-link').forEach(link=>link.addEventListener('click',()=>{
    try{const value=id('chat-input').value.trim();if(value)sessionStorage.setItem('thefa_core_pending_prompt',value.slice(0,4000));}catch{}
  }));
  id('account-logout').addEventListener('click',async()=>{
    if(model.busy){notify('답변이 끝난 후 로그아웃해 주세요.');return;}
    try{await request('/auth/logout',{method:'POST',body:'{}'});location.assign('/');}
    catch{notify('로그아웃하지 못했습니다. 다시 시도해 주세요.');}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){
    if(!id('composer-mode-panel').hidden){event.preventDefault();closeModePanel(true);}closeNav();
  }});
  window.addEventListener('pagehide',()=>{model.conversation=null;});
  init();
})();
