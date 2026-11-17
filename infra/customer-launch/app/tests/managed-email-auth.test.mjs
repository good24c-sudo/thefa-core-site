import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const file=new URL('../server/managed-email-auth.mjs',import.meta.url),exists=fs.existsSync(file);
test('fresh customer has a real managed signup/login adapter',()=>assert.equal(exists,true,'managed Supabase email adapter is not connected yet'));
const mod=exists?await import(file.href):{};
const ORIGIN='https://thefacore.com',BASE='https://cgrppxfdurpzzfvkmfte.supabase.co';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const user=(id=uid)=>({id,email:'qa@example.test',email_confirmed_at:'2026-11-17T00:00:00Z',created_at:'2026-11-17T00:00:00Z',user_metadata:{name:'Verified Customer'}});
function fixture(options={}){
 const calls=[];let revoked=false;let who=options.user||user();
 const fetcher=async(url,init={})=>{calls.push({url:String(url),method:init.method,body:init.body,headers:init.headers});
  const u=new URL(url);assert.equal(u.origin,BASE);assert.equal(init.redirect,'error');
  if(options.error)throw Error('SECRET_MUST_NOT_LEAK');
  if(u.pathname==='/auth/v1/signup')return Response.json({user:{id:uid,email:'qa@example.test',email_confirmed_at:null},session:null});
  if(u.pathname==='/auth/v1/token'){if(options.badPassword)return Response.json({error_code:'invalid_credentials'},{status:400});return Response.json({access_token:'synthetic-access-token-for-private-cookie',refresh_token:'never-exposed-refresh',expires_in:3600,token_type:'bearer',user:who});}
  if(u.pathname==='/auth/v1/user')return revoked?Response.json({code:'bad_jwt'},{status:401}):Response.json(who);
  if(u.pathname==='/auth/v1/logout'){revoked=true;return new Response(null,{status:204});}
  if(u.pathname==='/auth/v1/resend')return Response.json({});
  throw Error('UNEXPECTED_ENDPOINT '+u.pathname);
 };
 const auth=mod.createManagedEmailAuth({config:{accountMode:'fresh-launch',customerOrigin:ORIGIN,environment:'production',supabaseUrl:BASE,accountSecret:Buffer.alloc(32,19)},publishableKey:'sb_publishable_synthetic_12345678901234567890',cookieSecret:'synthetic-cookie-key-not-a-production-secret',fetchImpl:fetcher});
 const request=(route,body,cookie='',origin=ORIGIN)=>new Request(ORIGIN+route,{method:body===undefined?'GET':'POST',headers:{host:'thefacore.com',origin,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {auth,calls,request,whoChange:v=>who=v};
}
function check(name,fn){test(name,{skip:!exists},fn)}
check('signup forwards to existing provider and waits for email confirmation without session',async()=>{
 const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/signup',{email:'new@example.test',password:'Strong-local-test-password'}));
 assert.equal(r.status,202);assert.equal(r.headers.get('set-cookie'),null);const j=await r.json();assert.equal(j.verificationRequired,true);assert.equal(j.authenticated,false);assert.equal(x.calls.length,1);assert.ok(x.calls[0].url.includes('/auth/v1/signup'));
 assert.doesNotMatch(JSON.stringify(j),/access_token|Strong-local|refresh_token/);
});
check('password login only issues Secure HttpOnly cookie for a verified upstream account',async()=>{
 const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));
 assert.equal(r.status,200);const header=r.headers.get('set-cookie');assert.match(header,/Secure/);assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.doesNotMatch(header,/synthetic-access|refresh/);
 const cookie=header.split(';')[0],p=await x.auth.sessionVerifier(cookie);assert.equal(p.sessionVerified,true);assert.equal(p.user.id,uid);assert.equal(p.accountProvenance,'LAUNCH_ACCOUNT_CONFIRMED');assert.match(p.workspaceEmail,/^account_[a-f0-9]{64}@accounts\.thefa\.invalid$/);
});
check('unverified email does not acquire a customer session',async()=>{const x=fixture({user:{...user(),email_confirmed_at:null}});const r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);});
check('invalid credentials are not converted to successful login',async()=>{const x=fixture({badPassword:true});const r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'wrong-password'}));assert.equal(r.status,401);});
check('cross origin signup rejected before provider is called',async()=>{const x=fixture();const r=await x.auth.authRoutes(x.request('/auth/email/signup',{email:'qa@example.test',password:'test-password'},'','https://attacker.example'));assert.equal(r.status,403);assert.equal(x.calls.length,0);});
check('role escalation and unknown fields rejected before signup',async()=>{const x=fixture();const r=await x.auth.authRoutes(x.request('/auth/email/signup',{email:'qa@example.test',password:'test-password',role:'admin'}));assert.equal(r.status,400);assert.equal(x.calls.length,0);});
check('weak signup password rejected before creating a user',async()=>{const x=fixture();const r=await x.auth.authRoutes(x.request('/auth/email/signup',{email:'qa@example.test',password:'123'}));assert.equal(r.status,400);assert.equal(x.calls.length,0);});
check('unsigned forged cookie never becomes a verified session',async()=>{const x=fixture();assert.equal(await x.auth.sessionVerifier('__Host-thefa_customer_email=forged'),null);assert.equal(x.calls.length,0);});
check('same email different subject receives different isolated workspace',async()=>{
 const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));const p=await x.auth.sessionVerifier(r.headers.get('set-cookie').split(';')[0]);
 const y=fixture({user:user(other)}),s=await y.auth.authRoutes(y.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));const q=await y.auth.sessionVerifier(s.headers.get('set-cookie').split(';')[0]);assert.notEqual(p.principalId,q.principalId);assert.notEqual(p.workspaceEmail,q.workspaceEmail);
});
check('upstream subject changed after login fails closed',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));x.whoChange(user(other));assert.equal(await x.auth.sessionVerifier(r.headers.get('set-cookie').split(';')[0]),null);});
check('logout clears cookie and uses provider local-session logout',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'})),cookie=r.headers.get('set-cookie').split(';')[0];const out=await x.auth.authRoutes(x.request('/auth/logout',{},cookie));assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);assert.equal(await x.auth.sessionVerifier(cookie),null);});
check('network errors remain unavailable and never disclose raw errors',async()=>{const x=fixture({error:true});const r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SECRET_MUST/);});
check('provider catalog advertises only implemented email password flow',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/api/auth/providers'));const j=await r.json();assert.equal(r.status,200);assert.equal(j.email.method,'password-confirmed');assert.equal(j.email.enabled,true);assert.equal(j.providers.find(p=>p.id==='google').enabled,false);});
check('anonymous session returns unauthenticated not a 503 migration failure',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/api/auth/session'));assert.equal(r.status,200);assert.equal((await r.json()).authenticated,false);});
check('cookie tampering is detected',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/login',{email:'qa@example.test',password:'test-password'}));const cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(await x.auth.sessionVerifier(cookie.slice(0,-10)+'XXXXXXXXXX'),null);});
