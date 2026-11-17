import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createManagedEmailAuth} from '../server/managed-email-auth.mjs';
const ORIGIN='https://thefacore.com',BASE='https://cgrppxfdurpzzfvkmfte.supabase.co',UID='11111111-1111-4111-8111-111111111111',CODE='22222222-2222-4222-8222-222222222222';
const PWD='new-private-test-password';
function fixture(options={}){
 let now=Date.parse('2026-11-17T03:30:00Z'),challenge,changed=false;const calls=[];
 const user=()=>({id:UID,email:options.wrongEmail?'other@example.test':'owner@example.test',email_confirmed_at:'2026-10-01T00:00:00Z'});
 const fetchImpl=async(url,init)=>{const u=new URL(url);calls.push({path:u.pathname,query:u.search,method:init.method,body:init.body?JSON.parse(init.body):undefined});assert.equal(u.origin,BASE);
  if(u.pathname==='/auth/v1/recover'){challenge=JSON.parse(init.body).code_challenge;assert.equal(u.searchParams.get('redirect_to'),ORIGIN+'/login');return Response.json({});}
  if(u.pathname==='/auth/v1/token'){
   const body=JSON.parse(init.body);assert.equal(u.searchParams.get('grant_type'),'pkce');assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);
   if(options.invalidCode)return Response.json({error_code:'flow_state_not_found'},{status:400});
   return Response.json({access_token:'synthetic-private-access',expires_in:3600,token_type:'bearer',user:user()});
  }
  if(u.pathname==='/auth/v1/user'&&init.method==='GET')return Response.json(user());
  if(u.pathname==='/auth/v1/user'&&init.method==='PUT'){changed=true;assert.deepEqual(JSON.parse(init.body),{password:PWD});return Response.json(user());}
  if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});
  throw Error('UNEXPECTED_PROVIDER_ROUTE');
 };
 const auth=createManagedEmailAuth({config:{accountMode:'fresh-launch',environment:'production',customerOrigin:ORIGIN,supabaseUrl:BASE,accountSecret:Buffer.alloc(32,19)},publishableKey:'sb_publishable_synthetic_12345678901234567890',cookieSecret:'synthetic-cookie-key-not-production',fetchImpl,clock:()=>now});
 const request=(route,body,cookie='',origin=ORIGIN)=>new Request(ORIGIN+route,{method:'POST',headers:{host:'thefacore.com',origin,'content-type':'application/json',cookie},body:JSON.stringify(body)});
 return {auth,request,calls,changed:()=>changed,advance:ms=>now+=ms};
}
const cookieOf=r=>r.headers.getSetCookie().filter(x=>!x.includes('Max-Age=0')).map(x=>x.split(';')[0]).join('; ');
async function begin(x){const r=await x.auth.authRoutes(x.request('/auth/email/recover',{email:'owner@example.test'}));assert.equal(r.status,202);return cookieOf(r);}
async function verify(x){const c=await begin(x);const r=await x.auth.authRoutes(x.request('/auth/email/recovery/verify',{code:CODE},c));assert.equal(r.status,200);assert.equal((await r.clone().json()).verified,true);return cookieOf(r);}
test('recovery uses existing provider PKCE without exposing account existence or verifier',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/recover',{email:'owner@example.test'}));assert.equal(r.status,202);assert.equal((await r.json()).accepted,true);const c=r.headers.get('set-cookie');assert.match(c,/HttpOnly/);assert.match(c,/Secure/);assert.match(c,/SameSite=Lax/);assert.doesNotMatch(c,/owner@|synthetic/);assert.equal(x.calls[0].body.code_challenge_method,'s256');assert.match(x.calls[0].body.code_challenge,/^[A-Za-z0-9_-]{43}$/);});
test('PKCE mail callback gets a reset-only cookie, not customer session',async()=>{const x=fixture(),c=await verify(x);assert.match(c,/__Host-thefa_customer_recovery=/);assert.doesNotMatch(c,/__Host-thefa_customer_email=/);assert.equal(await x.auth.sessionVerifier(c),null);});
test('recovery callback without the requesting browser cookie is denied',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/recovery/verify',{code:CODE}));assert.equal(r.status,403);assert.equal(x.calls.length,0);});
test('wrong-email recovery is denied even when provider token is valid',async()=>{const x=fixture({wrongEmail:true}),c=await begin(x),r=await x.auth.authRoutes(x.request('/auth/email/recovery/verify',{code:CODE},c));assert.equal(r.status,403);assert.equal(cookieOf(r),'');});
test('expired PKCE cookie is refused before token exchange',async()=>{const x=fixture(),c=await begin(x);x.advance(31*60*1000);const r=await x.auth.authRoutes(x.request('/auth/email/recovery/verify',{code:CODE},c));assert.equal(r.status,403);assert.equal(x.calls.length,1);});
test('invalid/replayed provider code is not a verified reset',async()=>{const x=fixture({invalidCode:true}),c=await begin(x),r=await x.auth.authRoutes(x.request('/auth/email/recovery/verify',{code:CODE},c));assert.equal(r.status,403);assert.equal(x.changed(),false);});
test('password cannot change without verified recovery ticket',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/reset',{password:PWD}));assert.equal(r.status,403);assert.equal(x.calls.length,0);});
test('request-only cookie cannot change password',async()=>{const x=fixture(),c=await begin(x),r=await x.auth.authRoutes(x.request('/auth/email/reset',{password:PWD},c));assert.equal(r.status,403);assert.equal(x.changed(),false);});
test('verified recovery changes only own password and requires normal login',async()=>{const x=fixture(),c=await verify(x),r=await x.auth.authRoutes(x.request('/auth/email/reset',{password:PWD},c));assert.equal(r.status,200);const j=await r.json();assert.equal(j.success,true);assert.equal(j.requiresLogin,true);assert.equal(j.authenticated,false);assert.equal(x.changed(),true);assert.doesNotMatch(JSON.stringify(j),/access_token|private-test-password/);assert.ok(r.headers.getSetCookie().every(v=>v.includes('Max-Age=0')));});
test('short password rejected without provider update',async()=>{const x=fixture(),c=await verify(x),r=await x.auth.authRoutes(x.request('/auth/email/reset',{password:'123'},c));assert.equal(r.status,400);assert.equal(x.changed(),false);});
test('expired reset cookie cannot change password',async()=>{const x=fixture(),c=await verify(x);x.advance(11*60*1000);const r=await x.auth.authRoutes(x.request('/auth/email/reset',{password:PWD},c));assert.equal(r.status,403);assert.equal(x.changed(),false);});
test('cross-origin recovery does not send email',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/recover',{email:'owner@example.test'},'','https://attacker.invalid'));assert.equal(r.status,403);assert.equal(x.calls.length,0);});
test('recovery cannot accept role elevation fields',async()=>{const x=fixture(),r=await x.auth.authRoutes(x.request('/auth/email/recover',{email:'owner@example.test',role:'admin'}));assert.equal(r.status,400);assert.equal(x.calls.length,0);});

test('reset-only cookie cannot be renamed into a normal customer session',async()=>{const x=fixture(),c=await verify(x);assert.equal(await x.auth.sessionVerifier(c.replace('__Host-thefa_customer_recovery=','__Host-thefa_customer_email=')),null);});
