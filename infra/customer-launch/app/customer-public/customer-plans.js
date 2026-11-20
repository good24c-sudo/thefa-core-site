'use strict';
(() => {
 async function init(){
  try{
   const response=await fetch('/api/plans',{credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!response.ok)throw Error('PLAN_UNAVAILABLE');const catalog=await response.json();
   if(catalog.pricingVersion!=='THEFA_CORE_COST_CREDITS_20261120_V2'||!Array.isArray(catalog.plans))throw Error('PLAN_INVALID');
   for(const plan of catalog.plans){
    const card=document.querySelector('[data-plan="'+plan.id.toLowerCase()+'"]');if(!card)continue;
    card.querySelector('.plan-price').textContent=plan.priceGrossKrw.toLocaleString('ko-KR')+'원 / 월';
    card.querySelector('.plan-usage strong').textContent=plan.credits.toLocaleString('ko-KR')+' 크레딧 = '+plan.credits.toLocaleString('ko-KR')+'원 / 월';
   }
   document.querySelector('.pricing-note').textContent='1크레딧 = 1원 · 무료 체험 10회는 별도입니다. 유료 답변은 실제 API 사용량에 단가와 환율을 적용한 원가의 '+(catalog.pricingPolicy.markupBps/10000)+'배를 차감합니다. 답변 저장 후 최종 금액을 1원 단위로 올림하며 최소 '+catalog.pricingPolicy.minimumChargeCredits+'크레딧입니다. 부가세 포함 · 공급사 청구서 대사 전 원가 기준. 현재 유료 결제는 준비 중입니다.';
  }catch{
   document.querySelector('.pricing-note').textContent='요금제 정보를 새로 확인하지 못했습니다. 아래는 2026년 11월 20일 기준 안내입니다. 문의: thefa@thefa.kr';
  }
 }
 init();
})();

