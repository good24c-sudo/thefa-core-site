(()=>{
'use strict';
const $=(s,parent=document)=>parent.querySelector(s);
const el=(t,c='',value='')=>{const x=document.createElement(t);if(c)x.className=c;if(value)x.textContent=value;return x;};
function menuLink(label,icon,href,sub=''){
 const a=el('a','ux3-nav-link');a.href=href;
 const i=el('span','ux3-symbol',icon);i.setAttribute('aria-hidden','true');
 const name=el('span','ux3-nav-name',label);
 if(sub)name.append(el('small','',sub));
 a.append(i,name,el('span','ux3-chevron','›'));
 return a;
}
function apply(){
 const tools=$('.sidebar-quick-tools'),footer=$('.sidebar-bottom');
 if(!tools||!footer||tools.dataset.r4Live==='true')return;
 const studio=$('.studio-nav-entry',tools),oldMore=$('#sidebar-tools',tools);
 const oldItems=oldMore?$('.sidebar-tools-list',oldMore):null;
 const profile=$('#account-profile'),logout=$('#account-logout');
 if(!studio||!oldItems||!profile||!logout)return;
 // Move the ORIGINAL server-backed logout button, preserving its listener and hidden state.
 logout.classList.remove('bottom-action');logout.classList.add('ux3-logout');
 logout.setAttribute('aria-label','로그아웃');
 profile.after(logout);
 const section=el('div','ux3-section-title','WORKSPACE');
 const primary=menuLink('고도화 AI 업무실','✦','/paid-demo','단계별 AI 제작 · 기능 검증 중');
 primary.classList.add('ux3-primary');
 studio.classList.add('ux3-nav-link');
 studio.replaceChildren(el('span','ux3-symbol','▤'),el('span','ux3-nav-name','제작 스튜디오'),el('span','ux3-chevron','›'));
 const pc=menuLink('내 PC 연결','▣','/broker-preview/','고객 본인 PC 연결 · 준비 중');
 // Keep the original sidebar-tools-list element alive. The verified
 // production runtime appends extra account controls into it after initialization.
 const more=oldMore;
 more.classList.add('ux3-more');
 const summary=$('summary',more);
 summary.classList.add('ux3-more-summary');
 summary.replaceChildren(el('span','ux3-symbol','☷'),el('span','ux3-nav-name','전체 기능 · 설정'),el('span','ux3-chevron','⌄'));
 const contents=oldItems;
 contents.classList.add('ux3-more-content');
 contents.prepend(menuLink('THE FA World','◇','/world-original-v2','미래 비전 시뮬레이션'));
 contents.prepend(menuLink('내 업무 만들기','◫','/paid-demo','검토 중'));
 for(const item of [...contents.children]){
   if(item===logout)continue;
   item.classList.add('ux3-secondary');
 }
 tools.replaceChildren(section,primary,studio,pc,more);
 tools.dataset.r4Live='true';
 const search=$('#workspace-search');if(search)search.placeholder='대화 · 프로젝트 검색';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);
else apply();
})();