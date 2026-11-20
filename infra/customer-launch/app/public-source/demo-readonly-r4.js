(() => {
 document.addEventListener('DOMContentLoaded',()=>{
  const path=location.pathname;
  for(const s of ['#run','#pair-code','#submit','#refresh']){const b=document.querySelector(s);if(b){b.disabled=true;b.setAttribute('aria-disabled','true');}}
  const forms=[...document.querySelectorAll('form')];
  for(const f of forms)f.addEventListener('submit',e=>{e.preventDefault()},true);
  document.querySelectorAll('input, textarea, select').forEach(e=>e.disabled=true);
  const p=document.createElement('div');p.setAttribute('role','note');p.style.cssText='margin:18px auto;padding:12px 18px;border:1px solid #74603c;border-radius:10px;background:#231e16;color:#ead8b7;font:650 13px/1.6 system-ui;max-width:720px;text-align:center';
  p.textContent='이 화면은 기능을 확인하는 시연판입니다. 실제 AI 실행과 고객 PC 연결은 아직 지원하지 않으며, 입력·결제·개인정보 수집은 비활성화되어 있습니다.';
  const head=document.querySelector('main')||document.querySelector('section')||document.body;
  head.insertBefore(p,head.firstChild);
 });
})();