import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
import {createConfiguredCoreAuthPool} from '../server/inherited/server/auth/database.mjs';
import {configuredAuthBinding} from '../server/inherited/server/auth/configuration.mjs';

let starting:Promise<Awaited<ReturnType<typeof createGoogleOnlyCustomerAuthService>>>|undefined;
export function callbackOriginDiagnostics(request:Request,host:string){
 const h=request.headers;
 return {hostMissing:!h.has('host'),hostMatches:h.get('host')===host,forwardedHostMissing:!h.has('x-forwarded-host'),forwardedHostMatches:h.get('x-forwarded-host')===host,forwardedProtoMissing:!h.has('x-forwarded-proto'),forwardedProtoHttps:h.get('x-forwarded-proto')==='https',forwardedPresent:h.has('forwarded'),originalUrlPresent:h.has('x-original-url')};
}
function binding(){
 const environment=Deno.env.get('CUSTOMER_ENVIRONMENT'),customerOrigin=Deno.env.get('CUSTOMER_ORIGIN');
 const refs={staging:'furfjhymxqsbhvuyeqpx',production:'cgrppxfdurpzzfvkmfte'};
 const projectRef=refs[environment as keyof typeof refs];
 return configuredAuthBinding({environment,customerOrigin,issuer:'https://'+projectRef+'.supabase.co/functions/v1/core-customer-auth',mode:'callback'});
}
async function service(){
 if(!starting)starting=(async()=>{
  const config=binding();
  const database=createConfiguredCoreAuthPool({connectionString:Deno.env.get('CORE_CUSTOMER_AUTH_DATABASE_URL'),environment:config.environment,projectRef:config.projectRef,poolerHost:'aws-0-ap-northeast-2.pooler.supabase.com'});
  try{
   const row=(await database.query('select current_user,current_schema() as schema')).rows[0];
   if(row.current_user!=='core_customer_auth_runtime'||row.schema!=='core_customer_auth')throw Error('AUTH_ROLE_MISMATCH');
   const result=await createGoogleOnlyCustomerAuthService({database,environment:config.environment,customerOrigin:config.customerOrigin,issuer:config.issuer,mode:'callback',
    secret:Deno.env.get('CORE_CUSTOMER_AUTH_CALLBACK_SECRET'),proxySecret:Deno.env.get('CORE_CUSTOMER_AUTH_PROXY_SECRET'),
    google:{clientId:Deno.env.get('CORE_CUSTOMER_GOOGLE_CLIENT_ID'),clientSecret:Deno.env.get('CORE_CUSTOMER_GOOGLE_CLIENT_SECRET')}});
   const context=await result.auth.$context;if(typeof context.checkSchema!=='function')throw Error('AUTH_SCHEMA_CHECK_REQUIRED');await context.checkSchema();
   return result;
  }catch{await database.end();throw Error('CORE_CUSTOMER_AUTH_UNAVAILABLE')}
 })();
 return starting;
}

Deno.serve(async request=>{
 const fail=(status:number,code:string)=>Response.json({code},{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
 if(request.method!=='GET')return fail(404,'NOT_FOUND');
 try{
  const config=binding(),incoming=new URL(request.url),full='/functions/v1/core-customer-auth',short='/core-customer-auth';
  const suffix=incoming.pathname.startsWith(full+'/')?incoming.pathname.slice(full.length):incoming.pathname.startsWith(short+'/')?incoming.pathname.slice(short.length):null;
  if(suffix==='/callback/kakao')return fail(503,'LOGIN_PROVIDER_NOT_READY');
  if(!suffix||incoming.href.length>8192||!/^\/(?:customer\/providers|callback\/google)$/.test(suffix))return fail(404,'NOT_FOUND');
  const canonical=new URL(config.issuer+suffix);canonical.search=incoming.search;
  const response=await(await service()).fetch(new Request(canonical,{headers:request.headers}));
  if(response.status===403)console.error(JSON.stringify({code:'CORE_CUSTOMER_CALLBACK_HEADER_REJECTED',...callbackOriginDiagnostics(request,canonical.host)}));
  return response;
 }catch{return fail(503,'CORE_CUSTOMER_AUTH_UNAVAILABLE')}
});
