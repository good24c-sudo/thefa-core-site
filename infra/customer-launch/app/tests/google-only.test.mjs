import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync} from 'node:crypto';
import {readCustomerServerConfiguration} from '../server/bootstrap.mjs';
import {createCustomerAuthRoutes} from '../server/inherited/customer-auth-routes.mjs';
let api={};try{api=await import('../server/google-only-auth.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
const origin='https://thefa-core-customer-r39.vercel.app',issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const serviceOptions=mode=>({environment:'staging',customerOrigin:origin,issuer,mode,memory:true,secret:'isolated-google-only-auth-secret-32',proxySecret:'isolated-google-only-proxy-secret-32',google:{clientId:'isolated-google-id',clientSecret:'isolated-google-secret'}});
test('Google-only server configuration ignores all old Kakao environment values and requires Google credentials',()=>{
 const {publicKey}=generateKeyPairSync('ed25519'),env={CUSTOMER_ENVIRONMENT:'staging',CUSTOMER_ORIGIN:origin,NODEJS_HELPERS:'0',VERCEL:'1',CUSTOMER_SUPABASE_URL:'https://furfjhymxqsbhvuyeqpx.supabase.co',CUSTOMER_SERVICE_ROLE_KEY:'isolated-fixture-service-role',CUSTOMER_TENANT_KEY:'isolated-fixture-original-tenant-key',CUSTOMER_ACCOUNT_SECRET_BASE64:Buffer.alloc(32,1).toString('base64'),CUSTOMER_ALLOWANCE_SECRET_BASE64:Buffer.alloc(32,2).toString('base64'),CUSTOMER_BUDGET_SECRET_BASE64:Buffer.alloc(32,3).toString('base64'),CUSTOMER_DEEPSEEK_API_KEY:'sk-isolated-fixture-deepseek-key',CUSTOMER_AUTH_DATABASE_URL:'isolated-fixture-connection-string',CUSTOMER_AUTH_SECRET:'isolated-google-only-auth-secret-32',CUSTOMER_AUTH_PROXY_SECRET:'isolated-google-only-proxy-secret-32',CUSTOMER_GOOGLE_CLIENT_ID:'isolated-google-id',CUSTOMER_GOOGLE_CLIENT_SECRET:'isolated-google-secret',CUSTOMER_REDIRECTS_READY:'true',CUSTOMER_MIGRATION_PUBLIC_KEY_SPKI_BASE64:publicKey.export({type:'spki',format:'der'}).toString('base64')};let reads=0;
 for(const key of ['CUSTOMER_KAKAO_CLIENT_ID','CUSTOMER_KAKAO_CLIENT_SECRET'])Object.defineProperty(env,key,{enumerable:true,get(){reads++;throw Error('OLD_KAKAO_MUST_NOT_BE_READ')}});
 const settings=readCustomerServerConfiguration(env);assert.equal(settings.kakao,undefined);assert.equal(settings.google.clientId,'isolated-google-id');assert.equal(reads,0);
 delete env.CUSTOMER_GOOGLE_CLIENT_SECRET;assert.throws(()=>readCustomerServerConfiguration(env),/CUSTOMER_SERVER_CONFIGURATION_INVALID/);
});
test('Google-only actual pinned memory engine excludes Kakao even when a caller supplies old options',async()=>{
 assert.equal(typeof api.createGoogleOnlyCustomerAuthService,'function');const options=serviceOptions('callback');let reads=0;Object.defineProperty(options,'kakao',{enumerable:true,get(){reads++;throw Error('OLD_KAKAO_MUST_NOT_BE_READ')}});
 const service=await api.createGoogleOnlyCustomerAuthService(options),response=await service.fetch(new Request(issuer+'/customer/providers')),catalog=await response.json();
 assert.equal(catalog.providers.find(x=>x.id==='google').enabled,true);assert.equal(catalog.providers.find(x=>x.id==='kakao').enabled,false);assert.equal(service.auth.options.socialProviders.kakao,undefined);assert.equal(reads,0);
 const disabled=await service.fetch(new Request(issuer+'/callback/kakao?code=isolated&state=isolated'));assert.equal(disabled.status,503);assert.equal((await disabled.json()).code,'LOGIN_PROVIDER_NOT_READY');
});
test('Google-only HTTPS facade reports Kakao disabled and rejects Kakao start without provider network calls',async()=>{
 assert.equal(typeof api.createGoogleOnlyCustomerAuthService,'function');const authService=await api.createGoogleOnlyCustomerAuthService(serviceOptions('https')),providerService=await api.createGoogleOnlyCustomerAuthService(serviceOptions('callback')),handler=createCustomerAuthRoutes({authService,providerService,customerOrigin:origin,environment:'staging',issuer});
 const catalog=await(await handler(new Request(origin+'/api/auth/providers'))).json();assert.deepEqual(catalog.providers.map(x=>[x.id,x.enabled]),[['google',true],['kakao',false]]);
 const res=await handler(new Request(origin+'/auth/start',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"provider":"kakao"}'}));assert.equal(res.status,503);
 await assert.rejects(()=>authService.start({provider:'kakao'}),/LOGIN_PROVIDER_NOT_READY/);
});
test('Google-only client buttons trigger only Google start, and failed catalog disables it',async()=>{
 const source=await readFile(new URL('../public-source/customer-login.js',import.meta.url),'utf8');
 for(const pathname of ['/login','/signup']){
   const google={dataset:{provider:'google'},disabled:true,handlers:{},
     note:{textContent:''},querySelector(){return this.note},addEventListener(type,fn){this.handlers[type]=fn}};
   const status={textContent:'',classList:{add(){},remove(){}}};
   const group={querySelectorAll(){return [google]},setAttribute(){}};
   const guest={addEventListener(){}};
   const title={textContent:''};let starts=0;const redirects=[];
   const document={title:'',getElementById:id=>({
    'login-providers':group,'login-status':status,'continue-guest':guest,'login-title':title
   }[id])};
   const location={pathname,hash:'',assign:u=>redirects.push(u)};
   const fetch=async(route,options)=>route==='/api/auth/providers'?
     Response.json({issuer,providers:['google','kakao'].map(id=>({id,enabled:id==='google',callback:issuer+'/callback/'+id}))}):
     (starts++,assert.equal(route,'/auth/start'),assert.equal(JSON.parse(options.body).provider,'google'),
      Response.json({location:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({
       client_id:'isolated-google-id',state:'isolated-state-1234567890',
       redirect_uri:issuer+'/callback/google'})}));
   vm.runInNewContext(source,{document,location,fetch,URL},{timeout:1000});
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(google.disabled,false);
   await google.handlers.click();
   assert.equal(starts,1);
   assert.equal(new URL(redirects[0]).origin,'https://accounts.google.com');
 }
});
test('Google-only login and signup HTML no longer show a deferred Kakao button',async()=>{
 for(const file of ['login.html','signup.html']){
  const html=await readFile(new URL('../public-source/'+file,import.meta.url),'utf8');
  assert.match(html,/<button\b[^>]*data-provider="google"/);
  assert.doesNotMatch(html,/data-provider="kakao"/);
 }
});
