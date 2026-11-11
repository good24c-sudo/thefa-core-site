import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {generateKeyPair,SignJWT,jwtVerify} from 'jose';
import {createThefaCoreOidcHandler} from '../server/thefa-oidc-client.mjs';

const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1';
const origin='https://thefa-core-customer-test123.vercel.app';
const clientId='thefa-core-stage-public-client-01';
const env={THEFA_CORE_OIDC_ISSUER:issuer,THEFA_CORE_OIDC_ORIGIN:origin,THEFA_CORE_OIDC_CLIENT_ID:clientId,THEFA_CORE_OIDC_COOKIE_SECRET_BASE64URL:randomBytes(32).toString('base64url')};
const request=(url='/api/oidc/start',method='GET',headers={})=>({url,method,headers:{host:new URL(origin).host,...headers}});
const reply=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(v){this.body=v;}});
const json=res=>JSON.parse(res.body);
const {publicKey,privateKey}=await generateKeyPair('ES256');
const verifyJwt=(token,{issuer,audience})=>jwtVerify(token,publicKey,{issuer,audience,algorithms:['ES256']});
test('missing config fails closed',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env:{}})(request(),res,'start');
 assert.equal(res.statusCode,503);assert.equal(json(res).code,'THEFA_CORE_OIDC_NOT_CONFIGURED');
});
test('wrong origin blocked before any OAuth work',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env})(request('/api/oidc/start','GET',{host:'attacker.test'}),res,'start');
 assert.equal(res.statusCode,403);
});
test('start uses proper PKCE challenge, state, nonce and host-only protected transaction',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env})(request(),res,'start');
 assert.equal(res.statusCode,303);
 const u=new URL(res.headers.location);
 assert.equal(u.origin,'https://furfjhymxqsbhvuyeqpx.supabase.co');assert.equal(u.pathname,'/auth/v1/oauth/authorize');
 assert.equal(u.searchParams.get('client_id'),clientId);
 assert.equal(u.searchParams.get('redirect_uri'),origin+'/api/oidc/callback');
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 for(const k of ['state','nonce','code_challenge'])assert.match(u.searchParams.get(k),/^[A-Za-z0-9_-]{43}$/);
 assert.match(res.headers['set-cookie'][0],/^__Host-thefa_core_oidc_tx=/);
 assert.match(res.headers['set-cookie'][0],/Secure; HttpOnly; SameSite=Lax/);
 assert.doesNotMatch(res.headers['set-cookie'][0],/Domain=/);
});
test('invalid state cannot exchange a code',async()=>{
 const started=reply();await createThefaCoreOidcHandler({env})(request(),started,'start');
 const tx=started.headers['set-cookie'][0].split(';')[0];
 let calls=0;const fn=createThefaCoreOidcHandler({env,fetchImpl:async()=>{calls++;throw Error('cannot call');}});
 const res=reply();await fn(request('/api/oidc/callback?code=valid&state='+('X'.repeat(43)),'GET',{cookie:tx}),res,'callback');
 assert.equal(res.statusCode,403);assert.equal(calls,0);
});
test('mismatched OAuth issuer rejected before exchange',async()=>{
 const started=reply();await createThefaCoreOidcHandler({env})(request(),started,'start');
 const tx=started.headers['set-cookie'][0].split(';')[0],start=new URL(started.headers.location);
 const res=reply();await createThefaCoreOidcHandler({env})(request('/api/oidc/callback?code=a&state='+start.searchParams.get('state')+'&iss=https%3A%2F%2Fevil.test','GET',{cookie:tx}),res,'callback');
 assert.equal(res.statusCode,403);
});
test('real ES256 ID token exchange yields scoped session with no AI entitlement',async()=>{
 const started=reply();await createThefaCoreOidcHandler({env})(request(),started,'start');
 const tx=started.headers['set-cookie'][0].split(';')[0],start=new URL(started.headers.location);
 const now=Math.floor(Date.now()/1000),sub='11111111-1111-4111-8111-111111111111';
 const idToken=await new SignJWT({nonce:start.searchParams.get('nonce')})
  .setProtectedHeader({alg:'ES256'}).setIssuer(issuer).setAudience(clientId).setSubject(sub).setIssuedAt(now).setExpirationTime(now+600).sign(privateKey);
 let calls=0;
 const fn=createThefaCoreOidcHandler({env,verifyJwt,fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,issuer+'/oauth/token');assert.equal(init.body.get('grant_type'),'authorization_code');
  return {ok:true,json:async()=>({id_token:idToken,access_token:'opaque',token_type:'bearer'})};
 }});
 const res=reply();await fn(request('/api/oidc/callback?code=once&state='+start.searchParams.get('state'),'GET',{cookie:tx}),res,'callback');
 assert.equal(res.statusCode,303);assert.equal(res.headers.location,origin+'/login?oidc=verified');assert.equal(calls,1);
 const ticket=res.headers['set-cookie'].find(x=>x.startsWith('__Host-thefa_core_oidc_session=')).split(';')[0];
 const view=reply();await fn(request('/api/oidc/session','GET',{cookie:ticket}),view,'session');
 assert.equal(json(view).authenticated,true);assert.equal(json(view).canUseAi,false);assert.equal(json(view).accountLinked,false);
});
test('logout cross-origin denied without clearing sessions',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env})(request('/api/oidc/logout','POST',{origin:'https://evil.test'}),res,'logout');
 assert.equal(res.statusCode,403);assert.equal(res.headers['set-cookie'],undefined);
});
test('verified local logout clears only Core cookies',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env})(request('/api/oidc/logout','POST',{origin}),res,'logout');
 assert.equal(res.statusCode,200);assert.equal(json(res).scope,'CORE_LOCAL_ONLY');assert.equal(res.headers['set-cookie'].length,2);
 for(const c of res.headers['set-cookie'])assert.match(c,/Max-Age=0/);
});

test('Vercel Forwarded presence is ignored while canonical Host is verified',async()=>{
 const h={host:new URL(origin).host,'x-forwarded-host':new URL(origin).host,
   'x-forwarded-proto':'https',forwarded:'for=192.0.2.1;host=attacker.test;proto=http'};
 const res=reply();
 await createThefaCoreOidcHandler({env})(request('/api/oidc/status','GET',h),res,'status');
 assert.equal(res.statusCode,200);
 assert.equal(json(res).configured,true);
 assert.equal(json(res).canUseAi,false);
});
test('mismatched canonical Vercel forwarded host still blocked',async()=>{
 const h={host:new URL(origin).host,'x-forwarded-host':'evil.example',
   'x-forwarded-proto':'https',forwarded:'for=192.0.2.1'};
 const res=reply();
 await createThefaCoreOidcHandler({env})(request('/api/oidc/status','GET',h),res,'status');
 assert.equal(res.statusCode,403);
});

test('Core callback passes the actual OAuth access JWT to independently verified Stage Edge',async()=>{
 const started=reply();await createThefaCoreOidcHandler({env})(request(),started,'start');
 const tx=started.headers['set-cookie'][0].split(';')[0],start=new URL(started.headers.location);
 const now=Math.floor(Date.now()/1000),sub='11111111-1111-4111-8111-111111111111';
 const idToken=await new SignJWT({nonce:start.searchParams.get('nonce')})
  .setProtectedHeader({alg:'ES256'}).setIssuer(issuer).setAudience(clientId).setSubject(sub).setIssuedAt(now).setExpirationTime(now+600).sign(privateKey);
 const accessToken='eyJhbGciOiJFUzI1NiJ9.'+'A'.repeat(70)+'.'+'B'.repeat(64);
 let called=0;
 const handler=createThefaCoreOidcHandler({env,verifyJwt,
  fetchImpl:async()=>({ok:true,json:async()=>({id_token:idToken,access_token:accessToken,token_type:'bearer'})}),
  onVerifiedIdentity:async value=>{
   called++;
   assert.equal(value.issuer,issuer);assert.equal(value.audience,clientId);
   assert.equal(value.subject,sub);assert.equal(value.accessToken,accessToken);
   return {sessionVerified:true,subject:sub,canUseAi:false};
  }});
 const res=reply();
 await handler(request('/api/oidc/callback?code=once&state='+start.searchParams.get('state'),'GET',{cookie:tx}),res,'callback');
 assert.equal(called,1);assert.equal(res.statusCode,303);
 assert.ok(res.headers['set-cookie'].some(x=>x.startsWith('__Host-thefa_core_oidc_session=')));
 assert.equal(res.headers['set-cookie'].join('').includes(accessToken),false);
});
test('Core callback refuses to issue any SSO session when Stage Edge rejects token',async()=>{
 const started=reply();await createThefaCoreOidcHandler({env})(request(),started,'start');
 const tx=started.headers['set-cookie'][0].split(';')[0],start=new URL(started.headers.location);
 const now=Math.floor(Date.now()/1000),sub='11111111-1111-4111-8111-111111111111';
 const idToken=await new SignJWT({nonce:start.searchParams.get('nonce')})
  .setProtectedHeader({alg:'ES256'}).setIssuer(issuer).setAudience(clientId).setSubject(sub).setIssuedAt(now).setExpirationTime(now+600).sign(privateKey);
 const handler=createThefaCoreOidcHandler({env,verifyJwt,
  fetchImpl:async()=>({ok:true,json:async()=>({id_token:idToken,access_token:'opaque',token_type:'bearer'})}),
  onVerifiedIdentity:async()=>{throw Error('EDGE_UNAVAILABLE')}});
 const res=reply();
 await handler(request('/api/oidc/callback?code=once&state='+start.searchParams.get('state'),'GET',{cookie:tx}),res,'callback');
 assert.equal(res.statusCode,503);
 assert.equal(json(res).code,'THEFA_CORE_ACCOUNT_ADMISSION_UNAVAILABLE');
 assert.ok(!res.headers['set-cookie']?.some(x=>x.startsWith('__Host-thefa_core_oidc_session=')));
});
