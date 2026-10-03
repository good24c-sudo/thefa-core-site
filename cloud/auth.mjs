import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';

export const COOKIE_NAME='__Host-thefa_core_session';
export const ALLOWED_EMAILS=new Set(['thefa@thefa.kr','ceo@thefa.kr']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(status,message,extra={})=>Object.assign(new Error(message),{status,...extra});
const emailOf=value=>typeof value==='string'?value.trim().toLowerCase():'';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function createAuthService({origin,otpSecret,database,sendEmail,clock=Date.now}={}) {
  if(!origin?.startsWith('https://')||typeof otpSecret!=='string'||otpSecret.length<32||!database||!sendEmail) throw new Error('AUTH_CONFIGURATION_REQUIRED');
  const codeHash=(challengeId,email,code)=>createHmac('sha256',otpSecret).update(`${challengeId}\n${email}\n${code}`).digest('hex');
  function tokenFrom(header='') {
    if(typeof header!=='string')return null;
    const values=header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE_NAME+'='));
    if(values.length!==1)return null;
    const token=values[0].slice(COOKIE_NAME.length+1);
    return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
  }
  const cookie=(token,maxAge)=>`${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
  return {
    async requestCode(value) {
      const email=emailOf(value);
      if(!ALLOWED_EMAILS.has(email)) throw failure(403,'사전에 허가된 이메일만 참가할 수 있습니다.');
      const challengeId=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
      const result=await database.rpc('core_console_request_code_v2',{p_email:email,p_challenge_id:challengeId,p_code_hash:codeHash(challengeId,email,code)});
      if(!result?.accepted)throw failure(429,'잠시 후 인증코드를 다시 요청해 주세요.',{retryAfter:Math.max(1,Number(result?.retryAfter)||60)});
      try { await sendEmail({email,code,expiresIn:600,challengeId}); }
      catch { throw failure(502,'인증 메일을 발송하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
      return {challengeId,expiresIn:600,retryAfter:60};
    },
    async verifyCode({challengeId,code}={}) {
      if(typeof challengeId!=='string'||!UUID.test(challengeId)||typeof code!=='string'||!/^\d{6}$/.test(code))throw failure(400,'인증코드가 올바르지 않거나 만료되었습니다.');
      const challenge=await database.getChallenge(challengeId);
      if(!challenge||!ALLOWED_EMAILS.has(challenge.email))throw failure(400,'인증코드가 올바르지 않거나 만료되었습니다.');
      const token=randomBytes(32).toString('base64url');
      const result=await database.rpc('core_console_verify_code_v2',{p_challenge_id:challengeId,p_code_hash:codeHash(challengeId,challenge.email,code),p_session_hash:digest(token)});
      if(!result?.verified||!ALLOWED_EMAILS.has(result.email))throw failure(400,'인증코드가 올바르지 않거나 만료되었습니다.');
      return {email:result.email,cookie:cookie(token,28800)};
    },
    async getSession(header) {
      const token=tokenFrom(header);if(!token)return null;
      const row=await database.getSession(digest(token));
      if(!row||!ALLOWED_EMAILS.has(row.email)||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=clock())return null;
      return {email:row.email,expiresAt:row.expires_at};
    },
    async logout(header) {
      const token=tokenFrom(header);if(token)await database.deleteSession(digest(token));
      return cookie('',0);
    }
  };
}

export function createRestDatabase({url,key,fetchImpl=fetch}={}) {
  if(!/^https:\/\/[a-z\d]+\.supabase\.co$/.test(url||'')||typeof key!=='string'||key.length<20)throw new Error('PRIVATE_BETA_DATABASE_CONFIGURATION_REQUIRED');
  async function request(route,method='GET',body) {
    let response;
    try { response=await fetchImpl(url+'/rest/v1/'+route,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)}); }
    catch { throw failure(503,'인증 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if(!response.ok)throw failure(503,'인증 저장소가 요청을 처리하지 못했습니다.');
    return response.status===204?null:response.json();
  }
  return {
    rpc:(name,body)=>request('rpc/'+name,'POST',body),
    async getChallenge(id){const rows=await request('core_console_email_challenges_v2?select=email&id=eq.'+encodeURIComponent(id)+'&limit=1');return rows[0]||null;},
    async getSession(hash){const rows=await request('core_console_sessions_v2?select=email,expires_at&token_hash=eq.'+hash+'&limit=1');return rows[0]||null;},
    deleteSession:hash=>request('core_console_sessions_v2?token_hash=eq.'+hash,'DELETE')
  };
}

export function createResendSender({key,fetchImpl=fetch}={}) {
  if(typeof key!=='string'||!key.startsWith('re_'))throw new Error('EMAIL_SENDER_CONFIGURATION_REQUIRED');
  return async ({email,code,challengeId})=>{
    if(!ALLOWED_EMAILS.has(email)||!/^\d{6}$/.test(code))throw new Error('INVALID_EMAIL_REQUEST');
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'core-console-auth-'+challengeId},body:JSON.stringify({from:'THE FA Core <no-reply@thefa.kr>',to:[email],subject:'THE FA Core 참가 인증코드',text:`THE FA Core 초대 참가 인증코드: ${code}\n\n10분 안에 로그인 화면에 입력해 주세요. 한 번만 사용할 수 있습니다.\n요청하지 않으셨다면 이 메일을 무시해 주세요.\n\nTHE FA · https://core.thefa.kr`,html:`<div style="font-family:Arial,sans-serif;line-height:1.7"><h1>THE FA Core 참가 인증</h1><p>로그인 화면에 아래 인증코드를 입력해 주세요.</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>10분 안에 한 번만 사용할 수 있습니다. 요청하지 않으셨다면 이 메일을 무시해 주세요.</p><p>THE FA · <a href="https://core.thefa.kr">core.thefa.kr</a></p></div>`}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('EMAIL_DELIVERY_NOT_ACCEPTED');
    const data=await response.json();if(!data.id)throw new Error('EMAIL_DELIVERY_RECEIPT_MISSING');
    return {id:data.id};
  };
}
