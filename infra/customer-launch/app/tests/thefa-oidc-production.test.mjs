import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {generateKeyPair,SignJWT,jwtVerify} from 'jose';
import {createThefaCoreOidcHandler} from '../server/thefa-oidc-client.mjs';
const issuer='https://cgrppxfdurpzzfvkmfte.supabase.co/auth/v1';
const origin='https://thefacore.com';
const clientId='d672ff8a-df20-4e4c-906a-94be90affc04';
const cookieSecret=randomBytes(32).toString('base64url');
const env={THEFA_CORE_OIDC_ISSUER:issuer,THEFA_CORE_OIDC_ORIGIN:origin,
 THEFA_CORE_OIDC_CLIENT_ID:clientId,THEFA_CORE_OIDC_COOKIE_SECRET_BASE64URL:cookieSecret,VERCEL_ENV:'production'};
const request=(url='/api/oidc/start',headers={})=>({url,method:'GET',headers:{host:'thefacore.com',...headers}});
const reply=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(v){this.body=v}});
const parsed=res=>JSON.parse(res.body);
test('Core production readiness uses only FA_PRODUCTION OIDC and reports no AI entitlement',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env})(request('/api/oidc/status'),res,'status');
 assert.equal(res.statusCode,200);assert.equal(parsed(res).issuer,issuer);
 assert.equal(parsed(res).configured,true);assert.equal(parsed(res).canUseAi,false);
 assert.equal(parsed(res).stageEdgeAuthReady,false);
});
test('Core production PKCE login redirects to newly registered Core customer client exact callback',async()=>{
 const res=reply();await createThefaCoreOidcHandler({env})(request(),res,'start');
 assert.equal(res.statusCode,303);
 const url=new URL(res.headers.location);
 assert.equal(url.origin,'https://cgrppxfdurpzzfvkmfte.supabase.co');
 assert.equal(url.pathname,'/auth/v1/oauth/authorize');
 assert.equal(url.searchParams.get('client_id'),clientId);
 assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/oidc/callback');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.match(url.searchParams.get('state'),/^[A-Za-z0-9_-]{43}$/);
 assert.match(res.headers['set-cookie'][0],/^__Host-thefa_core_oidc_tx=/);
});
test('Core production rejects preview issuer or malformed host and never starts OAuth',async()=>{
 for(const bad of [
  {...env,THEFA_CORE_OIDC_ISSUER:'https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1',THEFA_CORE_OIDC_ORIGIN:'https://thefa-core-customer-test.vercel.app'},
  {...env,THEFA_CORE_OIDC_ORIGIN:'https://attacker.example'},
 ]){
  const res=reply();await createThefaCoreOidcHandler({env:bad})(request(),res,'start');assert.ok([403,503].includes(res.statusCode));assert.notEqual(res.statusCode,303);
 }
 const res=reply();await createThefaCoreOidcHandler({env})(request('/api/oidc/start',{host:'evil.example'}),res,'start');assert.equal(res.statusCode,403);
});
test('core production verifies real ES256 signed ID token claim, issuer, audience, nonce before issuing isolated account cookie',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('ES256');
 const started=reply();await createThefaCoreOidcHandler({env})(request(),started,'start');
 const challenge=new URL(started.headers.location),cookie=started.headers['set-cookie'][0].split(';')[0];
 const now=Math.floor(Date.now()/1000),subject='11111111-1111-4111-8111-111111111111';
 const idToken=await new SignJWT({nonce:challenge.searchParams.get('nonce')})
  .setProtectedHeader({alg:'ES256'}).setIssuer(issuer).setAudience(clientId).setSubject(subject)
  .setIssuedAt(now).setExpirationTime(now+600).sign(privateKey);
 const handler=createThefaCoreOidcHandler({env,
  verifyJwt:(token,claims)=>jwtVerify(token,publicKey,{issuer:claims.issuer,audience:claims.audience,algorithms:['ES256']}),
  fetchImpl:async(url,init)=>{
   assert.equal(url,issuer+'/oauth/token');
   assert.equal(init.body.get('redirect_uri'),origin+'/api/oidc/callback');
   assert.equal(init.body.get('client_id'),clientId);
   return {ok:true,json:async()=>({id_token:idToken,access_token:'opaque',token_type:'bearer'})};
  }});
 const state=challenge.searchParams.get('state');
 const callback=reply();
 await handler(request('/api/oidc/callback?code=abc&state='+state,{cookie}),callback,'callback');
 assert.equal(callback.statusCode,303);
 assert.equal(callback.headers.location,origin+'/login?oidc=verified');
 const sessionCookie=callback.headers['set-cookie'].find(x=>x.startsWith('__Host-thefa_core_oidc_session=')).split(';')[0];
 const session=reply();await handler(request('/api/oidc/session',{cookie:sessionCookie}),session,'session');
 assert.equal(session.statusCode,200);
 assert.equal(parsed(session).authenticated,true);
 assert.equal(parsed(session).accountLinked,false);
 assert.equal(parsed(session).canUseAi,false);
});
