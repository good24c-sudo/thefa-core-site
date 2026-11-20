import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createManagedEmailAuth} from '../server/managed-email-auth.mjs';

const origin='https://thefacore.com',base='https://cgrppxfdurpzzfvkmfte.supabase.co';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const requestName='__Host-thefa_customer_google_request',sessionName='__Host-thefa_customer_email';
const account=(id=uid)=>({id,email:'customer@example.test',email_confirmed_at:'2026-11-17T00:00:00Z',user_metadata:{name:'Customer'},app_metadata:{provider:'email'},identities:[{user_id:id,provider:'custom:google'}]});
const cookie=(r,name)=>r.headers.getSetCookie().find(s=>s.startsWith(name+'='))?.split(';')[0];
function fixture(options={}){
 let now=Date.now(),who=options.user??account(),revoked=false;
 const calls=[],codes=new Map();
 const fetchImpl=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;
  calls.push({path:u.pathname,grant:u.searchParams.get('grant_type'),body});
  assert.equal(u.origin,base);assert.equal(init.redirect,'error');
  if(options.networkError)throw Error('PRIVATE_UPSTREAM_ERROR_MUST_NOT_LEAK');
  if(u.pathname==='/auth/v1/token'){
   if(u.searchParams.get('grant_type')==='pkce'){
    const expected=codes.get(body.auth_code);codes.delete(body.auth_code);
    if(!expected||createHash('sha256').update(body.code_verifier).digest('base64url')!==expected)return Response.json({error_code:'invalid_grant'},{status:400});
   }
   return Response.json({access_token:'synthetic-google-private-access-token',token_type:'bearer',expires_in:3600,user:options.tokenUser??who,...options.tokenOverride});
  }
  if(u.pathname==='/auth/v1/user')return revoked?Response.json({},{status:401}):Response.json(who);
  if(u.pathname==='/auth/v1/logout'){revoked=true;return new Response(null,{status:204});}
  throw Error('EMAIL_OR_OTHER_ENDPOINT_NOT_ALLOWED');
 };
 const auth=createManagedEmailAuth({config:{accountMode:'fresh-launch',customerOrigin:origin,environment:'production',supabaseUrl:base,accountSecret:Buffer.alloc(32,19)},publishableKey:'sb_publishable_synthetic_12345678901234567890',cookieSecret:'synthetic-cookie-secret-for-isolated-tests',googleProvider:Object.hasOwn(options,'provider')?options.provider:'custom:google',fetchImpl,clock:()=>now});
 const req=(path,body,header='',extra={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{host:'thefacore.com',...(body===undefined?{}:{origin,'content-type':'application/json','sec-fetch-site':'same-origin'}),...(header?{cookie:header}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const call=(...args)=>auth.authRoutes(req(...args));
 const start=async()=>{
  const r=await call('/auth/start',{provider:'google'});assert.equal(r.status,200);
  const data=await r.json(),url=new URL(data.location),code=randomUUID();codes.set(code,url.searchParams.get('code_challenge'));
  return {r,data,url,code,pending:cookie(r,requestName)};
 };
 return {auth,req,call,start,calls,advance:ms=>now+=ms,whoChange:v=>who=v};
}

test('Google is opt-in and only the registered custom Google provider is accepted',async()=>{
 const x=fixture({provider:null});assert.equal((await x.call('/auth/start',{provider:'google'})).status,503);
 assert.equal((await (await x.call('/api/auth/providers')).json()).providers[0].enabled,false);
 assert.throws(()=>fixture({provider:'google'}),/CONFIGURATION_INVALID/);
 const y=fixture(),catalog=await (await y.call('/api/auth/providers')).json();
 assert.equal(catalog.providers[0].provider,'custom:google');assert.equal(catalog.providers[0].callback,origin+'/auth/google/callback');
});
test('Google start binds S256 PKCE to a private short-lived browser cookie and requests identity scopes only',async()=>{
 const x=fixture(),s=await x.start();
 assert.equal(s.url.origin+s.url.pathname,base+'/auth/v1/authorize');
 assert.equal(s.url.searchParams.get('provider'),'custom:google');
 assert.equal(s.url.searchParams.get('redirect_to'),origin+'/auth/google/callback');
 assert.equal(s.url.searchParams.get('code_challenge_method'),'s256');
 assert.match(s.url.searchParams.get('code_challenge'),/^[A-Za-z0-9_-]{43}$/);
 assert.equal(s.url.searchParams.get('scopes'),'openid email profile');assert.equal(s.url.searchParams.has('access_type'),false);
 assert.match(s.r.headers.get('set-cookie'),/Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
 assert.doesNotMatch(JSON.stringify(s.data),/verifier|access_token|refresh_token/);assert.equal(x.calls.length,0);
});
test('Google start rejects cross-site, extra identity fields, wrong providers and GET before calling upstream',async()=>{
 const x=fixture();
 for(const body of [{provider:'google',email:'admin@example.test'},{provider:'custom:google'},{provider:'kakao'},{}])assert.equal((await x.call('/auth/start',body)).status,400);
 assert.equal((await x.call('/auth/start',{provider:'google'},'',{origin:'https://evil.test'})).status,403);
 assert.equal((await x.call('/auth/start',{provider:'google'},'',{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await x.call('/auth/start')).status,405);assert.equal(x.calls.length,0);
});
test('verified Google callback issues the existing customer session with no email verification calls',async()=>{
 const x=fixture(),s=await x.start(),r=await x.call('/auth/google/callback?code='+s.code,undefined,s.pending);
 assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');
 assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.equal(r.headers.getSetCookie().length,2);assert.match(r.headers.getSetCookie()[0],/Max-Age=0/);
 assert.doesNotMatch(r.headers.get('set-cookie'),/synthetic-google|access_token|refresh_token/);
 const p=await x.auth.sessionVerifier(cookie(r,sessionName));assert.equal(p.user.id,uid);assert.equal(p.provider,'google');assert.equal(p.sessionVerified,true);
 const session=await (await x.call('/api/auth/session',undefined,cookie(r,sessionName))).json();assert.equal(session.method,'google');assert.equal(session.accountLinked,true);
 assert.deepEqual([...new Set(x.calls.map(c=>c.path))],['/auth/v1/token','/auth/v1/user']);
 assert.equal(x.calls[0].grant,'pkce');assert.match(x.calls[0].body.code_verifier,/^[A-Za-z0-9_-]{64}$/);
});
test('linked email and Google identities keep the same principal and workspace; a different UUID is isolated',async()=>{
 const x=fixture(),email=await x.call('/auth/email/login',{email:'customer@example.test',password:'synthetic-password'});
 const before=await x.auth.sessionVerifier(cookie(email,sessionName));
 const s=await x.start(),r=await x.call('/auth/google/callback?code='+s.code,undefined,s.pending),after=await x.auth.sessionVerifier(cookie(r,sessionName));
 assert.equal(before.principalId,after.principalId);assert.equal(before.workspaceEmail,after.workspaceEmail);
 const y=fixture({user:account(other)}),t=await y.start(),out=await y.call('/auth/google/callback?code='+t.code,undefined,t.pending);
 assert.notEqual((await y.auth.sessionVerifier(cookie(out,sessionName))).principalId,after.principalId);
});
test('missing, tampered, duplicated, expired and wrong-purpose cookies cannot exchange a Google code',async()=>{
 for(const kind of ['missing','tampered','duplicate','expired','recovery']){
  const x=fixture(),s=await x.start();let c=s.pending;
  if(kind==='missing')c='';if(kind==='tampered')c=c.slice(0,-12)+'XXXXXXXXXXXX';if(kind==='duplicate')c+='; '+c;
  if(kind==='expired')x.advance(601000);if(kind==='recovery')c=c.replace(requestName,'__Host-thefa_customer_recovery_request');
  const r=await x.call('/auth/google/callback?code='+s.code,undefined,c);
  assert.equal(r.headers.get('location'),'/login#google-expired',kind);assert.equal(cookie(r,sessionName),undefined);assert.equal(x.calls.length,0);
 }
});
test('callback rejects duplicate/unknown/unbounded query and wrong origin without leaking raw input',async()=>{
 const x=fixture(),s=await x.start();
 for(const q of ['code='+s.code+'&code='+s.code,'code='+s.code+'&next=https://evil.test','code=bad','error_description=PRIVATE_DETAIL','code='+s.code+'&error_description='+'x'.repeat(2048)]){
  const r=await x.call('/auth/google/callback?'+q,undefined,s.pending);
  assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login#google-failed');assert.equal(cookie(r,sessionName),undefined);
 }
 assert.equal((await x.call('/auth/google/callback?code='+s.code,undefined,s.pending,{host:'evil.test'})).status,403);assert.equal(x.calls.length,0);
});
test('cancelled Google authorization clears the request and uses a safe internal error page',async()=>{
 const x=fixture(),s=await x.start(),r=await x.call('/auth/google/callback?error=access_denied&error_description=PRIVATE_ERROR',undefined,s.pending);
 assert.equal(r.headers.get('location'),'/login#google-cancelled');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);assert.equal(x.calls.length,0);assert.equal(await r.text(),'');
});
test('replayed code and a code from a replaced browser flow cannot issue a session',async()=>{
 const x=fixture(),a=await x.start(),b=await x.start();
 const mismatch=await x.call('/auth/google/callback?code='+a.code,undefined,b.pending);assert.equal(cookie(mismatch,sessionName),undefined);
 const good=await x.call('/auth/google/callback?code='+b.code,undefined,b.pending);assert.equal(good.headers.get('location'),'/');
 const replay=await x.call('/auth/google/callback?code='+b.code,undefined,b.pending);assert.equal(replay.headers.get('location'),'/login#google-expired');assert.equal(cookie(replay,sessionName),undefined);
});
test('Google identity must come from the verified server user, not user-editable profile claims',async()=>{
 for(const user of [{...account(),identities:[],user_metadata:{provider:'custom:google',email_verified:true}}, {...account(),identities:[{user_id:other,provider:'custom:google'}]}, {...account(),identities:[{user_id:uid,provider:'google'}]}, {...account(),email_confirmed_at:null}, {...account(),is_anonymous:true}]){
  const x=fixture({user}),s=await x.start(),r=await x.call('/auth/google/callback?code='+s.code,undefined,s.pending);
  assert.equal(cookie(r,sessionName),undefined);assert.equal(r.headers.get('location'),'/login#google-failed');
 }
 const x=fixture({tokenUser:account(other)}),s=await x.start(),r=await x.call('/auth/google/callback?code='+s.code,undefined,s.pending);assert.equal(cookie(r,sessionName),undefined);
});
test('invalid/oversized token responses and upstream failures remain unauthenticated and sanitized',async()=>{
 for(const options of [{networkError:true},{tokenOverride:{access_token:'x'.repeat(2801)}},{tokenOverride:{token_type:'other'}},{tokenOverride:{expires_in:0}}]){
  const x=fixture(options),s=await x.start(),r=await x.call('/auth/google/callback?code='+s.code,undefined,s.pending);
  assert.equal(cookie(r,sessionName),undefined);assert.notEqual(r.headers.get('location'),'/');assert.doesNotMatch(r.headers.get('location'),/PRIVATE/);
 }
});
test('Google logout clears both browser cookies and revokes the current provider session',async()=>{
 const x=fixture(),s=await x.start(),r=await x.call('/auth/google/callback?code='+s.code,undefined,s.pending),session=cookie(r,sessionName);
 const out=await x.call('/auth/logout',{},session);assert.equal(out.status,200);assert.equal(out.headers.getSetCookie().length,2);assert.equal(await x.auth.sessionVerifier(session),null);
});
