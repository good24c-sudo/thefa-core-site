// Isolated QA enhancement: keep all original customer controls and layout.
document.addEventListener('DOMContentLoaded',()=>{
 const box=document.querySelector('.sidebar-quick-tools');
 if(!box||document.getElementById('qa-real-ai-workbench-link'))return;
 const a=document.createElement('a');
 a.id='qa-real-ai-workbench-link';a.className='sidebar-quick-link';
 a.href='/paid-demo.html';a.textContent='✦ AI로 실제 업무 만들기 (시험)';
 a.setAttribute('aria-label','실제 로컬 AI 업무 제작 격리 시험 화면');
 box.insertBefore(a,box.firstChild);
});