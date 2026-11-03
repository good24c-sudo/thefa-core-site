import {createConfiguredCustomerAuthService} from './inherited/server/auth/service.mjs';

/** Current release enables Google login only. Historical Kakao identities stay
 * supported by the data/migration modules, but old Kakao options are never read. */
export async function createGoogleOnlyCustomerAuthService(options={}){
 const {environment,customerOrigin,issuer,secret,proxySecret,database,memory=false,mode,google,testPlugins=[],sendVerificationOTP}=options;
 if(!google||['clientId','clientSecret'].some(name=>typeof google[name]!=='string'||!google[name]||google[name].length>8192||google[name]!==google[name].trim()||/[\x00-\x1f\x7f]/.test(google[name])))
  throw Object.assign(new Error('CUSTOMER_AUTH_CONFIGURATION_INVALID'),{code:'CUSTOMER_AUTH_CONFIGURATION_INVALID'});
 let service,context;
 try{
  service=await createConfiguredCustomerAuthService({environment,customerOrigin,issuer,secret,proxySecret,database,memory,mode,google:{...google,accessType:'offline',prompt:'consent select_account'},testPlugins,kakao:undefined,sendVerificationOTP});
  context=await service.auth.$context;
 }catch{throw Object.assign(new Error('CUSTOMER_AUTH_CONFIGURATION_INVALID'),{code:'CUSTOMER_AUTH_CONFIGURATION_INVALID'});}
 // Better Auth can prefer the ambient BETTER_AUTH_SECRETS keyring over an
 // explicit secret. Reject it rather than retaining or overriding old keys.
 if(context.secret!==secret||context.secretConfig!==secret)
  throw Object.assign(new Error('CUSTOMER_AUTH_SINGLE_KEY_REQUIRED'),{code:'CUSTOMER_AUTH_SINGLE_KEY_REQUIRED'});
 return service;
}
