import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
import {createConfiguredCoreProxyIdentityBackend} from '../server/inherited/server/auth/identity-backend.mjs';

// Real pinned BetterAuth/proxy code with an in-memory database and synthetic
// upstream responses. No Google account, production database or secret is used.
const origin='https://thefacore.com';
const issuer='https://cgrppxfdurpzzfvkmfte.supabase.co/functions/v1/core-customer-auth';
const options={environment:'production',customerOrigin:origin,issuer,memory:true,
 secret:'production-protocol-synthetic-secret-00000001',
 proxySecret:'production-protocol-synthetic-proxy-00000002',
 google:{clientId:'synthetic-client',clientSecret:'synthetic-client-secret'}};

test('Deno resolves the same narrow plugin entrypoints as the HTTPS server',async()=>{
 const config=JSON.parse(await readFile(new URL('../deno.json',import.meta.url),'utf8'));
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const source=await readFile(new URL('../server/inherited/server/auth/service.mjs',import.meta.url),'utf8');
 const plugins=[...source.matchAll(/from ['"](better-auth\/plugins[^'"]*)['"]/g)].map(m=>m[1]);
 assert.deepEqual(plugins,['better-auth/plugins/oauth-proxy','better-auth/plugins/email-otp']);
 for(const specifier of plugins)assert.equal(config.imports[specifier],'npm:better-auth@'+pkg.dependencies['better-auth']+specifier.slice('better-auth'.length));
});

test('production Google proxy isolates two identities, revokes logout, and retains identity on re-login',async()=>{
 const priorFetch=globalThis.fetch;let exchanges=0,network=0,subject='account-a';
 globalThis.fetch=async()=>{network++;throw Error('LIVE_NETWORK_FORBIDDEN_IN_ISOLATED_QA')};
 try{
  const plugin={id:'production-synthetic-google',init(context){
   const provider=context.socialProviders.find(p=>p.id==='google');
   provider.validateAuthorizationCode=async()=>{exchanges++;return {accessToken:'synthetic-access-'+subject}};
   provider.getUserInfo=async()=>({user:{id:subject,name:subject,email:subject+'@example.test',emailVerified:true},data:{sub:subject}});
  }};
  const callback=await createGoogleOnlyCustomerAuthService({...options,mode:'callback',testPlugins:[plugin]});
  const service=await createGoogleOnlyCustomerAuthService({...options,mode:'https'});
  const backend=createConfiguredCoreProxyIdentityBackend({service,issuer,customerOrigin:origin,
   fetchImpl:async url=>{assert.equal(url,issuer+'/customer/providers');return callback.fetch(new Request(url))}});
  async function login(id,flow){
   subject=id;
   const started=await backend.start({provider:'google',flow,headers:new Headers({origin})});
   const target=new URL(started.location);
   assert.equal(target.hostname,'accounts.google.com');
   assert.equal(target.searchParams.get('redirect_uri'),issuer+'/callback/google');
   const cookie=started.cookies.map(x=>x.split(';')[0]).join('; ');
   const upstream=await callback.fetch(new Request(issuer+'/callback/google?'+new URLSearchParams({code:'synthetic-code',state:target.searchParams.get('state')})));
   assert.equal(upstream.status,302);
   const bridge=upstream.headers.get('location');
   assert.ok(bridge.startsWith(origin+'/functions/v1/core-customer-auth/callback/google/oauth-proxy?'));
   const response=await service.fetch(new Request(bridge,{headers:{cookie}}));
   assert.equal(response.headers.get('location'),origin+'/auth/complete');
   const headers=response.headers.getSetCookie();
   assert.ok(headers.some(x=>/session_token=/.test(x)&&/; Secure/i.test(x)&&/; HttpOnly/i.test(x)));
   const signedCookie=headers.map(x=>x.split(';')[0]).join('; ');
   const current=await service.auth.api.getSession({headers:new Headers({cookie:signedCookie})});
   assert.equal(current.user.email,id+'@example.test');
   assert.equal(current.session.coreProviderId,'google');
   const replay=await service.fetch(new Request(bridge,{headers:{cookie}}));
   assert.notEqual(replay.headers.get('location'),origin+'/auth/complete');
   return {cookie:signedCookie,current};
  }
  const a=await login('account-a','a'.repeat(43)),b=await login('account-b','b'.repeat(43));
  assert.notEqual(a.current.user.id,b.current.user.id);
  await service.auth.api.signOut({headers:new Headers({origin,cookie:a.cookie})});
  assert.equal(await service.auth.api.getSession({headers:new Headers({cookie:a.cookie})}),null);
  assert.equal((await service.auth.api.getSession({headers:new Headers({cookie:b.cookie})})).user.id,b.current.user.id);
  const again=await login('account-a','c'.repeat(43));
  assert.equal(again.current.user.id,a.current.user.id);
  assert.notEqual(again.current.session.id,a.current.session.id);
  const context=await service.auth.$context;
  assert.equal((await context.internalAdapter.findAccounts(a.current.user.id)).length,1);
  assert.equal(exchanges,3);assert.equal(network,0);
 }finally{globalThis.fetch=priorFetch}
});

test('production HTTPS service refuses a staging callback issuer and staging public origin',async()=>{
 await assert.rejects(()=>createGoogleOnlyCustomerAuthService({...options,mode:'https',issuer:'https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth'}),{code:'CUSTOMER_AUTH_CONFIGURATION_INVALID'});
 await assert.rejects(()=>createGoogleOnlyCustomerAuthService({...options,mode:'https',customerOrigin:'https://thefa-core-customer.vercel.app'}),{code:'CUSTOMER_AUTH_CONFIGURATION_INVALID'});
});
