/* THE FA Core R7: strict screen mode detection, not a new router.
 * We observe the existing R6+AVA view state; do not send, clear, or alter drafts.
 * Only true chat mode shows the shared composer. Feature inputs stay in their frame.
 */
(() => {
  'use strict';
  const app=document.getElementById('app');
  const main=document.getElementById('chat-main');
  const chat=document.getElementById('chat-panel');
  if(!app||!main||!chat)return;
  const labels=Object.freeze({
    chat:'대화',world:'THE FA World',studio:'제작 스튜디오',
    workbench:'AI 업무실',pc:'내 PC 연결',about:'서비스 소개',
    plans:'요금제',install:'설치 안내',ava:'나의 AVA'
  });
  const toolbar=document.querySelector('.topbar-left');
  const backButton=document.createElement('button');
  backButton.type='button';
  backButton.id='r7-topbar-back';
  backButton.textContent='← 대화로';
  backButton.setAttribute('aria-label','작업 화면을 닫고 대화로 돌아가기');
  backButton.hidden=true;
  if(toolbar)toolbar.insertBefore(backButton,document.getElementById('breadcrumb'));
  backButton.addEventListener('click',()=>{
    const original=document.getElementById('r6-pane-back');
    const ava=document.getElementById('ava-secondbrain-root');
    if(ava&&!ava.hidden)document.getElementById('ava-p0-close')?.click();
    else if(original)original.click();
  });
  let previousMode='chat';
  let worldSidebarWasCollapsed=null;
  let breadcrumbBeforeTool=null;
  let queued=false;
  function readMode(){
    if(chat.hidden)return 'feature';
    const ava=document.getElementById('ava-secondbrain-root');
    if(ava&&!ava.hidden)return 'ava';
    const pane=document.getElementById('r6-inline-pane');
    if(pane&&!pane.hidden){
      const historyKey=history.state?.thefaR6Pane;
      if(Object.hasOwn(labels,historyKey)&&historyKey!=='chat'&&historyKey!=='ava')
        return historyKey;
      const text=document.getElementById('r6-pane-title')?.textContent?.trim()||'';
      const known=Object.entries(labels).find(([,value])=>value===text);
      return known?.[0]||'tool';
    }
    return 'chat';
  }
  function sync(){
    queued=false;
    const mode=readMode(),isTool=mode!=='chat'&&mode!=='feature';
    const wasWorld=previousMode==='world';
    if(mode==='world'&&!wasWorld&&innerWidth>780){
      worldSidebarWasCollapsed=app.classList.contains('r6-sidebar-collapsed');
      if(!worldSidebarWasCollapsed)document.getElementById('r6-toggle-sidebar')?.click();
    }
    if(wasWorld&&mode!=='world'&&worldSidebarWasCollapsed===false){
      if(app.classList.contains('r6-sidebar-collapsed')&&innerWidth>780)
        document.getElementById('r6-toggle-sidebar')?.click();
      worldSidebarWasCollapsed=null;
    }
    app.dataset.workspaceMode=mode;
    app.dataset.inputArea=mode==='chat'?'chat':(['ava','studio','workbench'].includes(mode)?'feature':'none');
    backButton.hidden=!isTool || mode==='ava';
    app.classList.toggle('r7-isolated-workspace',isTool);
    const crumb=document.getElementById('breadcrumb');
    if(crumb){
      if(isTool){
        if(breadcrumbBeforeTool===null)breadcrumbBeforeTool=crumb.textContent||'새 대화';
        crumb.textContent=labels[mode]||'작업공간';
      }else if(breadcrumbBeforeTool!==null){
        crumb.textContent=breadcrumbBeforeTool;
        breadcrumbBeforeTool=null;
      }
    }
    if(isTool){
      const input=document.getElementById('chat-input');
      if(input)input.setAttribute('aria-hidden','true');
      // Only the visibility changes; the input value and existing draft storage remain intact.
    } else {
      document.getElementById('chat-input')?.removeAttribute('aria-hidden');
    }
    previousMode=mode;
  }
  function schedule(){
    if(queued)return;queued=true;
    queueMicrotask(sync);
  }
  const watch=new MutationObserver(schedule);
  watch.observe(main,{attributes:true,attributeFilter:['hidden','class'],subtree:true,childList:true});
  window.addEventListener('popstate',schedule);
  window.addEventListener('hashchange',schedule);
  window.addEventListener('resize',schedule);
  schedule();
})();
