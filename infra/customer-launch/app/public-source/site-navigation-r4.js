(() => {
  'use strict';
  const routes=[
    {href:'/',label:'작업공간',short:'작업공간'},
    {href:'/paid-demo',label:'AI 업무실',short:'AI 업무실'},
    {href:'/studio',label:'제작 스튜디오',short:'제작'},
    {href:'/world-original-v2',label:'THE FA World',short:'World'},
    {href:'/broker-preview/',label:'내 PC 연결',short:'내 PC 연결'}
  ];
  const $=(s,p=document)=>p.querySelector(s);
  const el=(t,c='',text='')=>{const d=document.createElement(t);if(c)d.className=c;if(text)d.textContent=text;return d};
  const here=location.pathname.replace(/\.html$/,'').replace(/\/$/,'')||'/';
  function urlCurrent(path){return ((path.replace(/\/$/,'')||'/')===here)}
  const navLink=(item)=>{const a=el('a','',item.label);a.href=item.href;if(urlCurrent(item.href))a.setAttribute('aria-current','page');return a};
  function nav(){
    const n=el('nav','core-site-nav');n.setAttribute('aria-label','THE FA Core 서비스 이동');
    for(const r of routes)n.append(navLink(r));
    return n;
  }
  function mobileMenu(){
    const details=el('details','core-mobile-menu');
    const summary=el('summary','', '메뉴');
    summary.setAttribute('aria-label','서비스 메뉴 열기');
    const list=el('div','core-mobile-list');
    for(const r of routes)list.append(navLink(r));
    list.append(el('div','divider'));
    const login=el('a','ux3-safe-auth-link','실제 로그인');
    login.href='https://thefacore.com/login';login.rel='noopener noreferrer';
    list.append(login);
    details.append(summary,list);return details;
  }
  function brand({context='' }={}){
    const a=el('a','core-brand-official');
    a.href='/';a.setAttribute('aria-label','THE FA Core 고객 작업공간으로 이동');
    const img=el('img');img.src='/assets/THEFA_Core_Primary_Dark_web.svg';img.alt='THE FA Core 공식 로고';img.width=148;img.height=39;img.decoding='async';
    a.append(img);
    if(context)a.append(el('span','core-brand-context',context));
    return a;
  }
  function includeWorldInSidebar(){
    const navbox=$('.ux3-more-content');if(!navbox)return;
    if(!navbox.querySelector('a[href="/world-original-v2"]')){
      const a=el('a','ux3-secondary');a.href='/world-original-v2';a.textContent='◈ THE FA World · 미래 비전';
      navbox.insertBefore(a,navbox.firstChild);
    }
  }
  function setupWorld(){
    document.body.classList.add('world-r4');
    const header=$('header.topbar');
    if(header){
      const current=$('.brand',header);
      if(current)current.replaceWith(brand({context:'WORLD'}));
      header.append(nav(),mobileMenu());
    }
    const hud=$('#worldHud'),panel=$('#sidePanel');
    if(hud&&panel&&hud.parentNode===panel.parentNode)hud.parentNode.insertBefore(hud,panel);
    // Keep horizontal district selection inside the rail, never scroll the entire browser.
    // The source's scrollIntoView is separately replaced by the R4 adoption script.
  }
  function setupBroker(){
    document.body.classList.add('core-broker-r4');
    const header=$('body > header');
    if(header){
      header.replaceChildren(brand({context:'PC CONNECT'}),nav(),mobileMenu());
      header.classList.add('core-header-r4');
      const hint=el('div','', '웹에서 업무를 요청하고, 연결된 내 PC에서 실행하는 기능의 시험 화면입니다.');
      hint.id='core-preview-context';
      header.after(hint);
    }
    const first=$('body > p');
    if(first)first.classList.add('core-broker-intro');
  }
  function setupPaid(){
    document.body.classList.add('core-paid-r4');
    const header=$('header.topbar');
    if(!header)return;
    let existing=$('.brand',header);
    if(existing){
      existing.classList.add('core-brand-official');
      if(!existing.querySelector('img'))existing.replaceWith(brand({context:'AI WORKSPACE'}));
    }
    const current=$('.nav-actions',header);
    if(current)current.replaceChildren(nav(),mobileMenu());
    else header.append(nav(),mobileMenu());
  }
  function setupApp(){
    document.body.classList.add('core-app-r4');
    includeWorldInSidebar();
    const header=$('.workspace > .topbar');
    const area=$('.topbar-right',header||document);
    if(area){area.prepend(nav());}
  }
  function setupAuth(){
    document.body.classList.add('core-auth-r4');
    const header=$('body > header');
    if(header)header.append(nav(),mobileMenu());
  }
  function setupOther(kind){
    document.body.classList.add(kind);
    const header=$('body > header')||$('header.topbar')||$('.studio-root > header.studio-header');
    if(!header)return;
    if(!header.querySelector('img[src*="THEFA_Core_"]'))header.prepend(brand());
    header.append(nav(),mobileMenu());
  }
  function setup(){
    if(here==='/world-original-v2')setupWorld();
    else if(here==='/broker-preview')setupBroker();
    else if(here==='/paid-demo')setupPaid();
    else if(here==='/')setupApp();
    else if(here==='/login'||here==='/signup')setupAuth();
    else if(here==='/studio')setupOther('core-studio-r4');
    else if(here==='/about')setupOther('core-about-r4');
    else if(here==='/plans'||here==='/install')setupOther('core-info-r4');
    const menus=[...document.querySelectorAll('.core-mobile-menu')];
    document.addEventListener('click',(e)=>{
      for(const m of menus)if(m.open&&!m.contains(e.target))m.open=false;
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape')for(const m of menus)m.open=false;
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();