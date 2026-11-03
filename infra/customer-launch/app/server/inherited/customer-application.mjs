import {validateCustomerOrigin} from './customer-origin-policy.mjs';
const failure=(status,code)=>Response.json({code},{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const authPaths=new Set(['/api/auth/providers','/api/auth/session','/auth/start','/auth/logout','/auth/complete','/auth/email/send','/auth/email/verify']);
const proxy=/^\/functions\/v1\/core-customer-auth\/callback\/(google|kakao)\/oauth-proxy$/;
// Explicit composition only. Public serverless exports stay disabled until official admission.
export function createCustomerApplication({runtime,authRoutes,originConfig={}}={}){
 if(typeof runtime?.handler!=='function'||typeof authRoutes!=='function')
  throw new Error('CUSTOMER_APPLICATION_CONFIGURATION_REQUIRED');
 const origin=validateCustomerOrigin(originConfig),host=new URL(origin).host;
 return async request=>{
  try{
   if(!(request instanceof Request))return failure(400,'CUSTOMER_APPLICATION_REQUEST_REQUIRED');
   const url=new URL(request.url);
   if(url.origin!==origin||request.headers.get('host')!==host)
    return failure(403,'CUSTOMER_APPLICATION_ORIGIN_INVALID');
   if((url.search&&!proxy.test(url.pathname))||url.hash||url.pathname.includes('%')||url.pathname.includes('\\'))
    return failure(404,'CUSTOMER_APPLICATION_ROUTE_NOT_FOUND');
   if(url.pathname.startsWith('/api/customer/'))return await runtime.handler(request);
   if(authPaths.has(url.pathname)||proxy.test(url.pathname))return await authRoutes(request);
   return failure(404,'CUSTOMER_APPLICATION_ROUTE_NOT_FOUND');
  }catch{return failure(503,'CUSTOMER_APPLICATION_UNAVAILABLE')}
 };
}

