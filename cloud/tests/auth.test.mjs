import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, COOKIE_NAME } from '../auth.mjs';

function fixture(options={}) {
  let time=Date.now(), mails=[], rows=new Map(), sessions=new Map();
  const database={
    async rpc(name,p) {
      if(name==='core_console_request_code_v2') {
        const old=[...rows.values()].find(r=>r.email===p.p_email);
        if(old && time-old.sent<60000) return {accepted:false,retryAfter:60};
        if(old) rows.delete(old.id);
        rows.set(p.p_challenge_id,{id:p.p_challenge_id,email:p.p_email,hash:p.p_code_hash,attempts:0,used:false,expires:time+600000,sent:time});
        return {accepted:true,challengeId:p.p_challenge_id,expiresIn:600};
      }
      const row=rows.get(p.p_challenge_id);
      if(!row||row.used||row.expires<=time||row.attempts>=5) return {verified:false};
      row.attempts++;
      if(row.hash!==p.p_code_hash) return {verified:false};
      row.used=true;
      const expiresAt=new Date(time+28800000).toISOString();
      sessions.set(p.p_session_hash,{email:row.email,expires_at:expiresAt});
      return {verified:true,email:row.email,expiresAt};
    },
    async getChallenge(id){return rows.get(id)||null;},
    async getSession(hash){return sessions.get(hash)||null;},
    async deleteSession(hash){sessions.delete(hash);}
  };
  const auth=createAuthService({origin:'https://thefa-core-console.vercel.app',otpSecret:'test-only-secret-never-production-32bytes',database,sendEmail:async mail=>{mails.push(mail);if(options.mailFailure)throw new Error('Sender failed');return {id:'test-email-id'};},clock:()=>time});
  return {auth,mails,rows,sessions,advance:ms=>{time+=ms;}};
}
const cookieHeader=result=>result.cookie.split(';')[0];

test('Only the two exact emails may request a code; no code leaks in the response',async()=>{
  const f=fixture();
  for(const email of ['outsider@thefa.kr','thefa@thefa.kr.evil','ceo+alias@thefa.kr','']) await assert.rejects(f.auth.requestCode(email),e=>e.status===403);
  assert.equal(f.mails.length,0);
  const result=await f.auth.requestCode(' THEFA@THEFA.KR ');
  assert.equal(f.mails[0].email,'thefa@thefa.kr');
  assert.match(f.mails[0].code,/^\d{6}$/);
  assert.equal(result.code,undefined);
  assert.equal(f.rows.get(result.challengeId).hash.includes(f.mails[0].code),false);
});
test('Knowing the approved email or a forged cookie does not authenticate',async()=>{
  const f=fixture(); await f.auth.requestCode('ceo@thefa.kr');
  assert.equal(await f.auth.getSession(`${COOKIE_NAME}=ceo@thefa.kr`),null);
  assert.equal(await f.auth.getSession(`${COOKIE_NAME}=${'a'.repeat(43)}`),null);
  assert.equal(await f.auth.getSession(''),null);
});
test('Real code verification creates a Secure HttpOnly session, never a browser token payload',async()=>{
  const f=fixture(); const challenge=await f.auth.requestCode('ceo@thefa.kr');
  const result=await f.auth.verifyCode({challengeId:challenge.challengeId,code:f.mails[0].code});
  assert.equal(result.email,'ceo@thefa.kr'); assert.match(result.cookie,/HttpOnly; Secure; SameSite=Lax/);
  assert.match(result.cookie,/Path=\//); assert.equal(result.token,undefined);
  assert.equal((await f.auth.getSession(cookieHeader(result))).email,'ceo@thefa.kr');
  await assert.rejects(f.auth.verifyCode({challengeId:challenge.challengeId,code:f.mails[0].code}),e=>e.status===400);
});
test('Expired codes and five wrong attempts never create a session',async()=>{
  let f=fixture(), c=await f.auth.requestCode('thefa@thefa.kr');f.advance(600001);
  await assert.rejects(f.auth.verifyCode({challengeId:c.challengeId,code:f.mails[0].code}),e=>e.status===400);
  f=fixture();c=await f.auth.requestCode('thefa@thefa.kr');const wrong=f.mails[0].code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)await assert.rejects(f.auth.verifyCode({challengeId:c.challengeId,code:wrong}),e=>e.status===400);
  await assert.rejects(f.auth.verifyCode({challengeId:c.challengeId,code:f.mails[0].code}),e=>e.status===400);
  assert.equal(f.sessions.size,0);
});
test('Resend cooldown is atomic at database contract and does not send duplicate mail',async()=>{
  const f=fixture(); await f.auth.requestCode('thefa@thefa.kr');
  await assert.rejects(f.auth.requestCode('thefa@thefa.kr'),e=>e.status===429&&e.retryAfter===60);
  assert.equal(f.mails.length,1);f.advance(60001);await f.auth.requestCode('thefa@thefa.kr');assert.equal(f.mails.length,2);
});
test('Log out and expiry invalidate access server-side',async()=>{
  const f=fixture(),c=await f.auth.requestCode('thefa@thefa.kr');
  const result=await f.auth.verifyCode({challengeId:c.challengeId,code:f.mails[0].code});
  assert.equal((await f.auth.getSession(cookieHeader(result))).email,'thefa@thefa.kr');
  const cleared=await f.auth.logout(cookieHeader(result));assert.match(cleared,/Max-Age=0/);
  assert.equal(await f.auth.getSession(cookieHeader(result)),null);
});
test('Expired and non-allowlisted stored sessions are refused',async()=>{
  const f=fixture(),c=await f.auth.requestCode('ceo@thefa.kr');
  const result=await f.auth.verifyCode({challengeId:c.challengeId,code:f.mails[0].code});
  f.advance(28800001);assert.equal(await f.auth.getSession(cookieHeader(result)),null);
  for(const row of f.sessions.values()){row.email='outsider@thefa.kr';row.expires_at=new Date(Date.now()+999999999).toISOString();}
  assert.equal(await f.auth.getSession(cookieHeader(result)),null);
});
test('Mail delivery errors fail closed and weak configuration is refused',async()=>{
  const f=fixture({mailFailure:true});await assert.rejects(f.auth.requestCode('thefa@thefa.kr'),e=>e.status===502);
  assert.throws(()=>createAuthService({origin:'https://x.example',otpSecret:'weak'}),/AUTH_CONFIGURATION/);
});
