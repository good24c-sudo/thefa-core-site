import {validateCustomerOrigin} from '../../customer-origin-policy.mjs';

export const LEGACY_IDENTITY_REALM='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
export const AUTH_PATH='/functions/v1/core-customer-auth';
export const AUTH_PROJECTS=Object.freeze({staging:'furfjhymxqsbhvuyeqpx',production:'cgrppxfdurpzzfvkmfte'});
export const AUTH_ROLE='core_customer_auth_runtime',AUTH_SCHEMA='core_customer_auth';
export const AUTH_POOLER='aws-0-ap-northeast-2.pooler.supabase.com';
export function configuredAuthBinding({environment,customerOrigin,issuer,mode}={}){
 try{
  if(!Object.hasOwn(AUTH_PROJECTS,environment)||typeof customerOrigin!=='string'||!['callback','https'].includes(mode))throw Error();
  const origin=validateCustomerOrigin({environment,customerOrigin}),projectRef=AUTH_PROJECTS[environment];
  if(origin!==customerOrigin||issuer!=='https://'+projectRef+'.supabase.co'+AUTH_PATH)throw Error();
  return Object.freeze({environment,customerOrigin:origin,issuer,mode,projectRef,role:AUTH_ROLE,schema:AUTH_SCHEMA,legacyIdentityRealm:LEGACY_IDENTITY_REALM});
 }catch{throw Object.assign(new Error('CUSTOMER_AUTH_CONFIGURATION_INVALID'),{code:'CUSTOMER_AUTH_CONFIGURATION_INVALID'})}
}
