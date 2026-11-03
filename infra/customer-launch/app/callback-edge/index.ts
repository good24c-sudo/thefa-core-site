import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
import {createConfiguredCoreAuthPool} from '../server/inherited/server/auth/database.mjs';
import {configuredAuthBinding} from '../server/inherited/server/auth/configuration.mjs';

let starting:Promise<Awaited<ReturnType<typeof createGoogleOnlyCustomerAuthService>>>|undefined;
export function callbackOriginDiagnostics(request:Request,host:string){
 const h=request.headers;
 return {hostMissing:!h.has('host'),hostMatches:h.get('host')===host,forwardedHostMissing:!h.has('x-forwarded-host'),forwardedHostMatches:h.get('x-forwarded-host')===host,forwardedProtoMissing:!h.has('x-forwarded-proto'),forwardedProtoHttps:h.get('x-forwarded-proto')==='https',forwardedPresent:h.has('forwarded'),originalUrlPresent:h.has('x-original-url')};
}
export function normalizeCallbackPlatformRequest(request:Request,canonical:URL){
 // Supabase's documented relay supplies this internal Host. Map that single
 // transport authority to the server-configured issuer; never derive an issuer
 // from forwarding headers or permit arbitrary relay hosts.
 const incoming=new URL(request.url),h=new Headers(request.headers),hosts=new Set([canonical.host,'edge-runtime.supabase.com']);
 const diagnostics={urlHttps:incoming.protocol==='https:',urlHttp:incoming.protocol==='http:',urlHostCanonical:incoming.host===canonical.host,urlHostInternal:incoming.host==='edge-runtime.supabase.com',urlHostLoopback:incoming.hostname==='127.0.0.1'||incoming.hostname==='localhost',headerHostCanonical:h.get('host')===canonical.host,headerHostInternal:h.get('host')==='edge-runtime.supabase.com',...callbackOriginDiagnostics(request,canonical.host)};
 if(incoming.protocol!=='https:'||!hosts.has(incoming.host)||
   (h.has('host')&&!hosts.has(h.get('host')!))||
   (h.has('x-forwarded-host')&&!hosts.has(h.get('x-forwarded-host')!))||
   (h.has('x-forwarded-proto')&&h.get('x-forwarded-proto')!=='https')||h.has('forwarded')||h.has('x-original-url')){console.error(JSON.stringify({code:'CORE_CUSTOMER_RELAY_REJECTED',...diagnostics}));throw Error('CUSTOMER_AUTH_ORIGIN_INVALID');}
 h.set('host',canonical.host);if(h.has('x-forwarded-host'))h.set('x-forwarded-host',canonical.host);
 return new Request(canonical,{headers:h});
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
  const response=await(await service()).fetch(normalizeCallbackPlatformRequest(request,canonical));
  if(response.status===403)console.error(JSON.stringify({code:'CORE_CUSTOMER_CALLBACK_HEADER_REJECTED',...callbackOriginDiagnostics(request,canonical.host)}));
  return response;
 }catch(error){console.error(JSON.stringify({code:'CORE_CUSTOMER_EDGE_FAILED',originRejected:error instanceof Error&&error.message==='CUSTOMER_AUTH_ORIGIN_INVALID'}));return fail(503,'CORE_CUSTOMER_AUTH_UNAVAILABLE')}
});
