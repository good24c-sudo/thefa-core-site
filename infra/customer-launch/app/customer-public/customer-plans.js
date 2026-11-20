'use strict';
(() => {
 async function init(){
  try{
   const response=await fetch('/api/plans',{credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!response.ok)throw Error('PLAN_UNAVAILABLE');const catalog=await response.json();
   if(catalog.pricingVersion!=='THEFA_CORE_MONTHLY_20261120_V1'||!Array.isArray(catalog.plans))throw Error('PLAN_INVALID');
   for(const plan of catalog.plans){
    const card=document.querySelector('[data-plan="'+plan.id.toLowerCase()+'"]');if(!card)continue;
    card.querySelector('.plan-price').textContent=plan.priceGrossKrw.toLocaleString('ko-KR')+'원 / 월';
    card.querySelector('.plan-usage strong').textContent=plan.credits.toLocaleString('ko-KR')+' 크레딧 / 월';
   }
   document.querySelector('.pricing-note').textContent='월 결제 기준 · 부가세 포함 · 일반 AI 답변 저장 완료 시 1크레딧. 결제 연결 후 월 제공량이 적용됩니다. 현재 유료 결제는 준비 중이며, 요금제 안내만으로 결제되거나 이용권이 부여되지 않습니다.';
  }catch{
   document.querySelector('.pricing-note').textContent='요금제 정보를 새로 확인하지 못했습니다. 아래는 2026년 11월 20일 기준 안내입니다. 문의: thefa@thefa.kr';
  }
 }
 init();
})();
