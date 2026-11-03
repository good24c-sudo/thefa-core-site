'use strict';
(() => {
  async function init(){
    try{
      const response=await fetch('/api/customer/plans',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('PLAN_UNAVAILABLE');const catalog=await response.json();
      for(const plan of catalog.plans){
        const card=document.querySelector('[data-plan="'+plan.id+'"]');if(!card)continue;
        card.querySelector('h2').textContent=plan.name;
        const period={MONTHLY:' / 월',ANNUAL:' / 년'}[catalog.billingCycle]||'';
        card.querySelector('.plan-price').textContent=plan.priceKrw.toLocaleString('ko-KR')+'원'+period;
      }
    }catch{
      document.querySelectorAll('[data-plan] .plan-price').forEach(price=>price.textContent='확인 중');
      document.querySelector('.pricing-note').textContent='요금제 정보를 확인하지 못했습니다. 현재 결제·구독은 연결되지 않았습니다.';
    }
  }
  init();
})();
