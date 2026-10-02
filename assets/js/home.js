/* THEFA Core Homepage V2 — homepage-only behaviour. */
(function () {
  'use strict';
  document.documentElement.classList.add('home-v2-ready');
  function initSectionNav(){
    var header=document.querySelector('[data-site-header]'); if(!header) return;
    var links=[].slice.call(header.querySelectorAll('.nav a'));
    var ids=['product','how','usecases','trust'];
    function setActive(id){ links.forEach(function(a){a.removeAttribute('aria-current');}); var a=header.querySelector('.nav a[href="index.html#'+id+'"]'); if(a) a.setAttribute('aria-current','true'); }
    function sync(){ var y=window.scrollY+header.offsetHeight+Math.min(220,window.innerHeight*.28), current='product'; ids.forEach(function(id){var s=document.getElementById(id); if(s&&s.offsetTop<=y) current=id;}); setActive(current); }
    links.forEach(function(a){ if(/^index\.html#/.test(a.getAttribute('href')||'')) a.addEventListener('click',function(){setActive((a.getAttribute('href').split('#')[1]||'product'));}); });
    var ticking=false; window.addEventListener('scroll',function(){if(!ticking){ticking=true;requestAnimationFrame(function(){sync();ticking=false;});}},{passive:true}); window.addEventListener('resize',sync); sync();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initSectionNav); else requestAnimationFrame(initSectionNav);
})();
