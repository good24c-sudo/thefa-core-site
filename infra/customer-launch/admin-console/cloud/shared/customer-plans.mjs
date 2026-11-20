import {DEFAULT_PRICING_POLICY,verifyPricingPolicy} from './customer-pricing-policy.mjs';
export const PRICING_VERSION='THEFA_CORE_COST_CREDITS_20261120_V2';
export const SUPPORT_EMAIL='thefa@thefa.kr';
export const CUSTOMER_PLANS=Object.freeze([
 Object.freeze({id:'FREE',name:'FREE',priceGrossKrw:0,billingPeriod:'once',credits:0,freeTrialAnswers:10,seats:1,vatIncluded:true,availability:'AVAILABLE'}),
 Object.freeze({id:'STANDARD',name:'STANDARD',priceGrossKrw:19000,billingPeriod:'month',credits:19000,seats:1,vatIncluded:true,availability:'PAYMENT_CONNECTION_PENDING'}),
 Object.freeze({id:'PRO',name:'PRO',priceGrossKrw:49000,billingPeriod:'month',credits:49000,seats:1,vatIncluded:true,availability:'PAYMENT_CONNECTION_PENDING'}),
 Object.freeze({id:'ENTERPRISE',name:'ENTERPRISE',priceGrossKrw:null,billingPeriod:'contract',credits:null,seats:5,vatIncluded:true,availability:'CONTACT'})
]);
export function customerPlanCatalog(policy=DEFAULT_PRICING_POLICY){const p=verifyPricingPolicy(policy);return {pricingVersion:PRICING_VERSION,currency:'KRW',supportEmail:SUPPORT_EMAIL,
 plans:CUSTOMER_PLANS.map(plan=>({...plan,...(plan.id==='STANDARD'?{credits:p.standardMonthlyCredits}:plan.id==='PRO'?{credits:p.proMonthlyCredits}:{}),creditUnit:'KRW'})),paymentReady:false,paymentProvider:'PORTONE_V2',
 creditPolicy:'SAVED_ANSWER_COST_TIMES_MARKUP',creditValueKrw:1,freeTrialAnswers:10,pricingPolicy:p,
 existingFreeAllowancePreserved:true,paidCreditsGranted:false};}

