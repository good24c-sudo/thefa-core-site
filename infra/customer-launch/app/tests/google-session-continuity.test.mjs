import test from 'node:test';
import assert from 'node:assert/strict';
import {symmetricEncrypt,symmetricDecrypt} from 'better-auth/crypto';
import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
import {createConfiguredCoreProxyIdentityBackend} from '../server/inherited/server/auth/identity-backend.mjs';
const origin='https://thefa-core-customer-r39.vercel.app';
const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const secret='synthetic-current-auth-continuity-fixture-00001';
const options=mode=>({environment:'staging',customerOrigin:origin,issuer,mode,memory:true,secret,proxySecret:'synthetic-proxy-continuity-fixture-00002',google:{clientId:'synthetic-google-client',clientSecret:'synthetic-google-secret'}});

test('real Google authorization request obtains offline consent for long lived employee sessions',async()=>{
 const service=await createGoogleOnlyCustomerAuthService(options('https'));
 const response=await service.start({provider:'google',headers:new Headers({origin}),flow:'c'.repeat(43)});
 assert.equal(response.status,200);
 const body=await response.json(),url=new URL(body.url);
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('access_type'),'offline');
 const prompt=new Set((url.searchParams.get('prompt')??'').split(' '));
 assert.equal(prompt.has('consent'),true);
 assert.equal(prompt.has('select_account'),true);
 assert.equal(url.searchParams.get('redirect_uri'),issuer+'/callback/google');
 assert.deepEqual(new Set(url.searchParams.get('scope').split(' ')),new Set(['openid','email','profile']));
});

test('pinned real token API refreshes expired employee token using internal account id and signed session',async()=>{
 let tokenCalls=0;const previousFetch=globalThis.fetch;
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(input instanceof Request?input.url:input);
  assert.equal(u.href,'https://oauth2.googleapis.com/token');
  assert.equal(init.method,'POST');tokenCalls++;
  const body=new URLSearchParams(init.body);
  assert.equal(body.get('grant_type'),'refresh_token');
  assert.equal(body.get('refresh_token'),'synthetic-refresh-current');
  return Response.json({access_token:'synthetic-refreshed-access',token_type:'Bearer',expires_in:3600,scope:'openid email profile'});
 };
 try{
  const plugin={id:'synthetic-continuity-google',init(context){const provider=context.socialProviders.find(x=>x.id==='google');
   provider.validateAuthorizationCode=async()=>({accessToken:'synthetic-initial-access',refreshToken:'synthetic-refresh-current',accessTokenExpiresAt:new Date(Date.now()+60000)});
   provider.getUserInfo=async()=>({user:{id:'synthetic-continuity-subject',name:'Synthetic',email:'synthetic@thefa.kr',emailVerified:true},data:{sub:'synthetic-continuity-subject'}});
  }};
  const callback=await createGoogleOnlyCustomerAuthService({...options('callback'),testPlugins:[plugin]});
  const service=await createGoogleOnlyCustomerAuthService(options('https'));
  const backend=createConfiguredCoreProxyIdentityBackend({service,issuer,customerOrigin:origin,fetchImpl:async url=>{assert.equal(url,issuer+'/customer/providers');return callback.fetch(new Request(url))}});
  const started=await backend.start({provider:'google',flow:'d'.repeat(43),headers:new Headers({origin})});
  const authUrl=new URL(started.location),bindingCookie=started.cookies.map(x=>x.split(';')[0]).join('; ');
  const bridgeResponse=await callback.fetch(new Request(issuer+'/callback/google?'+new URLSearchParams({code:'synthetic-code',state:authUrl.searchParams.get('state')})));
  const web=await service.fetch(new Request(bridgeResponse.headers.get('location'),{headers:{cookie:bindingCookie}}));
  assert.equal(web.headers.get('location'),origin+'/auth/complete');
  const cookie=web.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),headers=new Headers({cookie});
  const current=await service.auth.api.getSession({headers});assert.equal(current.user.email,'synthetic@thefa.kr');
  const adapter=(await service.auth.$context).internalAdapter;
  const account=await adapter.findAccountByKey({providerId:'google',accountId:'synthetic-continuity-subject'});
  await adapter.updateAccount(account.id,{accessToken:await symmetricEncrypt({key:secret,data:'synthetic-expired-access'}),accessTokenExpiresAt:new Date(Date.now()-60000)});
  const refreshed=await service.auth.api.getAccessToken({headers,body:{accountId:account.id}});
  assert.equal(refreshed.accessToken,'synthetic-refreshed-access');assert.equal(tokenCalls,1);
  const saved=await adapter.findAccountByKey({providerId:'google',accountId:'synthetic-continuity-subject'});
  assert.equal(saved.id,account.id);assert.equal(saved.userId,current.user.id);
  assert.equal(await symmetricDecrypt({key:secret,data:saved.accessToken}),'synthetic-refreshed-access');
  assert.equal(await symmetricDecrypt({key:secret,data:saved.refreshToken}),'synthetic-refresh-current');
  const again=await service.auth.api.getAccessToken({headers,body:{accountId:account.id}});
  assert.equal(again.accessToken,'synthetic-refreshed-access');assert.equal(tokenCalls,1);
 }finally{globalThis.fetch=previousFetch;}
});
