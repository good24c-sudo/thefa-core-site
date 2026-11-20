(() => {
 'use strict';
 function init() {
  const sidebar=document.getElementById('sidebar');
  const tools=sidebar?.querySelector('.sidebar-quick-tools');
  const nav=sidebar?.querySelector('.navigation');
  const detail=sidebar?.querySelector('#sidebar-tools');
  if(!sidebar||!nav||!tools||!detail||nav.dataset.singleScrollR4==='ready')return;
  // The original menu elements are MOVED, never cloned: account/logout event
  // handlers, links and project list remain the same.
  nav.insertBefore(tools,nav.firstChild);
  nav.setAttribute('tabindex','0');
  nav.setAttribute('aria-label','작업 메뉴 및 프로젝트·대화 목록');
  nav.dataset.singleScrollR4='ready';
  tools.setAttribute('aria-label','더파코어 작업 메뉴');
  // A single scroll container handles wheel, touch, keyboard and zoom. Keep
  // nested menu content in normal document flow, not a second scroll trap.
  detail.addEventListener('toggle',()=>{
    if(!detail.open)return;
    const summary=detail.querySelector('summary');
    if(!summary)return;
    requestAnimationFrame(()=>{
      if(!detail.open)return;
      const n=nav.getBoundingClientRect(),r=summary.getBoundingClientRect();
      if(r.bottom>n.bottom-8)nav.scrollTop+=r.bottom-n.bottom+12;
    });
  });
 }
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();