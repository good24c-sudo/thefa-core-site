import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handleOAuthUserInfo} from 'better-auth/oauth2';
import {symmetricEncrypt,symmetricDecrypt} from 'better-auth/crypto';
import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
import {createConfiguredCoreProxyIdentityBackend} from '../server/inherited/server/auth/identity-backend.mjs';

// These are synthetic fixture strings. No deployment credential or customer
// account/token is read by this suite; only the pinned memory adapter is used.
const origin='https://thefa-core-customer-r39.vercel.app',issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const oldSecret='isolated-retired-auth-key-fixture-0000000001',newSecret='isolated-current-auth-key-fixture-0000000002';
const options=()=>({environment:'staging',customerOrigin:origin,issuer,mode:'callback',memory:true,secret:newSecret,proxySecret:'isolated-current-proxy-key-fixture-0000000003',google:{clientId:'isolated-google-id',clientSecret:'isolated-google-secret'}});

test('Google-only factory rejects an ambient keyring even if its current key equals the explicit key',async()=>{
 const prior=process.env.BETTER_AUTH_SECRETS;
 try{
  process.env.BETTER_AUTH_SECRETS='1:'+newSecret+',0:'+oldSecret;
  await assert.rejects(()=>createGoogleOnlyCustomerAuthService(options()),error=>error.code==='CUSTOMER_AUTH_SINGLE_KEY_REQUIRED');
 }finally{if(prior===undefined)delete process.env.BETTER_AUTH_SECRETS;else process.env.BETTER_AUTH_SECRETS=prior;}
});

test('Google-only factory rejects ambient replacement keys and does not silently overwrite that configuration',async()=>{
 const prior=process.env.BETTER_AUTH_SECRETS;
 try{
  const value='1:'+oldSecret;process.env.BETTER_AUTH_SECRETS=value;
  await assert.rejects(()=>createGoogleOnlyCustomerAuthService(options()),error=>error.code==='CUSTOMER_AUTH_SINGLE_KEY_REQUIRED');
  assert.equal(process.env.BETTER_AUTH_SECRETS,value);
 }finally{if(prior===undefined)delete process.env.BETTER_AUTH_SECRETS;else process.env.BETTER_AUTH_SECRETS=prior;}
});

test('pinned existing Google sign-in uses the same user/account and new key while an omitted refresh token stays old',async()=>{
 const service=await createGoogleOnlyCustomerAuthService(options()),context=await service.auth.$context,adapter=context.internalAdapter;
 assert.equal(context.secretConfig,newSecret);
 const google=await adapter.createUser({name:'Synthetic Google',email:'synthetic-google@example.test',emailVerified:true});
 const kakao=await adapter.createUser({name:'Synthetic Kakao',email:'synthetic-kakao@example.test',emailVerified:false});
 const oldAccess=await symmetricEncrypt({key:oldSecret,data:'synthetic-old-google-access'}),oldRefresh=await symmetricEncrypt({key:oldSecret,data:'synthetic-old-google-refresh'});
 const googleAccount=await adapter.createAccount({userId:google.id,providerId:'google',accountId:'synthetic-google-subject',accessToken:oldAccess,refreshToken:oldRefresh,idToken:'synthetic-old-id-token'});
 const kakaoAccount=await adapter.createAccount({userId:kakao.id,providerId:'kakao',accountId:'123456789',accessToken:'synthetic-disabled-kakao-ciphertext',refreshToken:'synthetic-disabled-kakao-refresh'});
 const stableKey=Buffer.alloc(32,61),accountKey=id=>createHmac('sha256',stableKey).update(issuer+'|'+id).digest('hex');
 const before={googleId:google.id,kakaoId:kakao.id,googleAccountId:googleAccount.id,kakaoAccountId:kakaoAccount.id,googleLegacyKey:accountKey(google.id),kakaoLegacyKey:accountKey(kakao.id)};
 const login=account=>handleOAuthUserInfo({context,setCookie(){}},{userInfo:{id:'synthetic-google-subject',name:'Synthetic Google',email:google.email,emailVerified:true},account:{providerId:'google',accountId:'synthetic-google-subject',...account},callbackURL:origin+'/auth/complete'});
 const first=await login({accessToken:'synthetic-fresh-google-access',idToken:'synthetic-fresh-id-token'});
 assert.equal(first.error,null);assert.equal(first.isRegister,false);assert.equal(first.data.user.id,google.id);assert.equal(first.data.session.userId,google.id);
 const current=await adapter.findAccountByKey({providerId:'google',accountId:'synthetic-google-subject'});
 assert.equal(current.id,googleAccount.id);assert.equal(current.userId,google.id);
 assert.equal(await symmetricDecrypt({key:newSecret,data:current.accessToken}),'synthetic-fresh-google-access');
 await assert.rejects(()=>symmetricDecrypt({key:oldSecret,data:current.accessToken}));
 assert.equal(current.refreshToken,oldRefresh);await assert.rejects(()=>symmetricDecrypt({key:newSecret,data:current.refreshToken}));
 assert.equal(current.idToken,'synthetic-fresh-id-token');
 const second=await login({accessToken:'synthetic-second-access',refreshToken:'synthetic-fresh-google-refresh'});
 assert.equal(second.error,null);assert.equal(second.isRegister,false);
 const refreshed=await adapter.findAccountByKey({providerId:'google',accountId:'synthetic-google-subject'});
 assert.equal(refreshed.id,googleAccount.id);assert.equal(await symmetricDecrypt({key:newSecret,data:refreshed.refreshToken}),'synthetic-fresh-google-refresh');
 const retainedKakao=await adapter.findAccountByKey({providerId:'kakao',accountId:'123456789'});
 assert.deepEqual(retainedKakao,kakaoAccount);
 assert.deepEqual({...before,googleLegacyKey:accountKey(first.data.user.id),kakaoLegacyKey:accountKey(kakao.id)},before);
 assert.equal((await adapter.findAccounts(google.id)).length,1);assert.equal((await adapter.findAccounts(kakao.id)).length,1);
});

test('new current key rejects the retired key ciphertext without configuring fallback',async()=>{
 const service=await createGoogleOnlyCustomerAuthService(options()),context=await service.auth.$context;
 const retired=await symmetricEncrypt({key:oldSecret,data:'synthetic-retired-token'});
 await assert.rejects(()=>symmetricDecrypt({key:context.secretConfig,data:retired}));
 const current=await symmetricEncrypt({key:context.secretConfig,data:'synthetic-current-token'});
 assert.equal(await symmetricDecrypt({key:newSecret,data:current}),'synthetic-current-token');
});

test('pinned Google proxy callback re-login retains existing identity with new token encryption and denies replay',async()=>{
 let providerExchanges=0,externalNetwork=0;const savedFetch=globalThis.fetch;
 globalThis.fetch=async()=>{externalNetwork++;throw Error('SYNTHETIC_PROVIDER_NETWORK_FORBIDDEN')};
 try{
  const plugin={id:'synthetic-current-google-provider',init(context){const provider=context.socialProviders.find(x=>x.id==='google');
   provider.validateAuthorizationCode=async()=>{providerExchanges++;return{accessToken:'synthetic-proxy-fresh-access',refreshToken:'synthetic-proxy-fresh-refresh'}};
   provider.getUserInfo=async()=>({user:{id:'synthetic-proxy-subject',name:'Synthetic',email:'synthetic-proxy@example.test',emailVerified:true},data:{sub:'synthetic-proxy-subject'}});
  }};
  const callback=await createGoogleOnlyCustomerAuthService({...options(),testPlugins:[plugin]}),service=await createGoogleOnlyCustomerAuthService({...options(),mode:'https'});
  const context=await service.auth.$context,user=await context.internalAdapter.createUser({name:'Synthetic',email:'synthetic-proxy@example.test',emailVerified:true});
  const originalAccount=await context.internalAdapter.createAccount({userId:user.id,providerId:'google',accountId:'synthetic-proxy-subject',accessToken:await symmetricEncrypt({key:oldSecret,data:'synthetic-before-rotation-access'}),refreshToken:await symmetricEncrypt({key:oldSecret,data:'synthetic-before-rotation-refresh'})});
  const backend=createConfiguredCoreProxyIdentityBackend({service,issuer,customerOrigin:origin,fetchImpl:async url=>{assert.equal(url,issuer+'/customer/providers');return callback.fetch(new Request(url))}});
  const flow='f'.repeat(43),started=await backend.start({provider:'google',flow,headers:new Headers({origin})}),target=new URL(started.location);
  assert.equal(target.searchParams.get('redirect_uri'),issuer+'/callback/google');
  const cookie=started.cookies.map(x=>x.split(';')[0]).join('; '),upstream=await callback.fetch(new Request(issuer+'/callback/google?'+new URLSearchParams({code:'synthetic-google-code',state:target.searchParams.get('state')})));
  assert.equal(upstream.status,302);const bridge=upstream.headers.get('location');assert.ok(bridge.startsWith(service.baseUrl+'/callback/google/oauth-proxy?'));
  const response=await service.fetch(new Request(bridge,{headers:{cookie}}));assert.equal(response.headers.get('location'),origin+'/auth/complete');
  const signedCookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),current=await service.auth.api.getSession({headers:new Headers({cookie:signedCookie})});
  assert.equal(current.user.id,user.id);assert.equal(current.session.userId,user.id);assert.equal(current.session.coreProviderId,'google');
  assert.equal((await backend.complete({cookie:signedCookie,flow})).user.id,user.id);
  const account=await context.internalAdapter.findAccountByKey({providerId:'google',accountId:'synthetic-proxy-subject'});
  assert.equal(account.id,originalAccount.id);assert.equal(account.userId,user.id);assert.equal((await context.internalAdapter.findAccounts(user.id)).length,1);
  assert.equal(await symmetricDecrypt({key:newSecret,data:account.accessToken}),'synthetic-proxy-fresh-access');
  assert.equal(await symmetricDecrypt({key:newSecret,data:account.refreshToken}),'synthetic-proxy-fresh-refresh');
  await assert.rejects(()=>symmetricDecrypt({key:oldSecret,data:account.accessToken}));
  const replay=await service.fetch(new Request(bridge,{headers:{cookie}}));assert.notEqual(replay.headers.get('location'),origin+'/auth/complete');
  assert.equal(providerExchanges,1);assert.equal(externalNetwork,0);
 }finally{globalThis.fetch=savedFetch;}
});
