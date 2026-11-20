export const PRICING_VERSION='THEFA_CORE_MONTHLY_20261120_V1';
export const SUPPORT_EMAIL='thefa@thefa.kr';
export const CUSTOMER_PLANS=Object.freeze([
 Object.freeze({id:'FREE',name:'FREE',priceGrossKrw:0,billingPeriod:'once',credits:10,seats:1,vatIncluded:true,availability:'AVAILABLE'}),
 Object.freeze({id:'STANDARD',name:'STANDARD',priceGrossKrw:19000,billingPeriod:'month',credits:500,seats:1,vatIncluded:true,availability:'PAYMENT_CONNECTION_PENDING'}),
 Object.freeze({id:'PRO',name:'PRO',priceGrossKrw:49000,billingPeriod:'month',credits:1800,seats:1,vatIncluded:true,availability:'PAYMENT_CONNECTION_PENDING'}),
 Object.freeze({id:'ENTERPRISE',name:'ENTERPRISE',priceGrossKrw:null,billingPeriod:'contract',credits:null,seats:5,vatIncluded:true,availability:'CONTACT'})
]);
export function customerPlanCatalog(){return {pricingVersion:PRICING_VERSION,currency:'KRW',supportEmail:SUPPORT_EMAIL,
 plans:CUSTOMER_PLANS,paymentReady:false,paymentProvider:'PORTONE_V2',
 creditPolicy:'GENERAL_ANSWER_SUCCESSFULLY_SAVED_EQUALS_ONE',
 existingFreeAllowancePreserved:true,paidCreditsGranted:false};}
