export const MEMBERSHIP_CONTRACT='THEFA_CORE_CUSTOMER_MEMBERSHIP_V1';
const hash=/^[a-f0-9]{64}$/;
export function touchCustomerMembership(state,{session,at=new Date().toISOString()}={}){
 if(!state||state.version!==2||session?.sessionVerified!==true||!hash.test(session.principalId??'')||!Number.isFinite(Date.parse(at)))
  throw Object.assign(Error('CUSTOMER_MEMBERSHIP_BINDING_INVALID'),{code:'CUSTOMER_MEMBERSHIP_BINDING_INVALID'});
 let member=state.customerMembership;
 if(member){
  if(member.contract!==MEMBERSHIP_CONTRACT||member.principalRef!==session.principalId||member.status!=='ACTIVE')throw Error('CUSTOMER_MEMBERSHIP_CONFLICT');
  member.lastSeenAt=at;
 }else{
  member=state.customerMembership={contract:MEMBERSHIP_CONTRACT,principalRef:session.principalId,
   status:'ACTIVE',firstObservedAt:at,lastSeenAt:at,authMethod:session.provider,
   membershipBasis:'VERIFIED_CORE_CUSTOMER_SESSION',historicalSignupAt:null};
 }
 return {recorded:true};
}
export function membershipNeedsTouch(state,at=Date.now()){
 const last=Date.parse(state?.customerMembership?.lastSeenAt??'');
 return !Number.isFinite(last)||at-last>=3600000;
}
