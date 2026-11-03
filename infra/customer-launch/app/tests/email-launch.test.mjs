import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
const origin='https://thefa-core-customer-r39.vercel.app',issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const options=()=>({environment:'staging',customerOrigin:origin,issuer,mode:'https',memory:true,secret:'synthetic-email-launch-auth-key-00000000',proxySecret:'synthetic-email-launch-proxy-key-0000000',google:{clientId:'fixture-google-id',clientSecret:'fixture-google-secret'}});
const cookies=r=>r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
async function setup(){const sent=[];const service=await createGoogleOnlyCustomerAuthService({...options(),sendVerificationOTP:async data=>sent.push(data)});assert.equal(typeof service.auth.api.sendVerificationOTP,'function','Email OTP is missing from the actual existing engine');return {service,sent,headers:new Headers({origin})};}
test('real pinned email OTP verifies ownership, creates signed session, tags email provider, hides code',async()=>{
 const {service,sent,headers}=await setup(),email='staff@thefa.kr';
 const send=await service.auth.api.sendVerificationOTP({headers,body:{email,type:'sign-in'},asResponse:true});assert.equal(send.status,200);assert.equal(sent.length,1);assert.match(sent[0].otp,/^\d{6}$/);assert.doesNotMatch(await send.text(),new RegExp(sent[0].otp));
 const login=await service.auth.api.signInEmailOTP({headers,body:{email,otp:sent[0].otp},asResponse:true});assert.equal(login.status,200);
 const current=await service.auth.api.getSession({headers:new Headers({cookie:cookies(login)})});assert.equal(current.user.email,email);assert.equal(current.user.emailVerified,true);assert.equal(current.session.coreProviderId,'email');
 assert.ok(current.session.expiresAt>Date.now());assert.ok(new Date(current.session.expiresAt).getTime()<=Date.now()+12*3600000+2000);
});
test('wrong OTP cannot create an authenticated account; correct OTP is single use',async()=>{
 const {service,sent,headers}=await setup(),email='guest@example.test';await service.auth.api.sendVerificationOTP({headers,body:{email,type:'sign-in'}});
 const wrong=sent[0].otp==='000000'?'111111':'000000';await assert.rejects(()=>service.auth.api.signInEmailOTP({headers,body:{email,otp:wrong}}));
 const ok=await service.auth.api.signInEmailOTP({headers,body:{email,otp:sent[0].otp},asResponse:true});assert.equal(ok.status,200);
 await assert.rejects(()=>service.auth.api.signInEmailOTP({headers,body:{email,otp:sent[0].otp}}));
});
test('email login ignores forged role/provider fields and logout rejects original signed session',async()=>{
 const {service,sent,headers}=await setup(),email='member@example.test';await service.auth.api.sendVerificationOTP({headers,body:{email,type:'sign-in'}});
 const response=await service.auth.api.signInEmailOTP({headers,body:{email,otp:sent[0].otp,coreProviderId:'google',role:'ADMIN',emailVerified:true},asResponse:true});
 const signed=new Headers({cookie:cookies(response),origin});const current=await service.auth.api.getSession({headers:signed});assert.equal(current.session.coreProviderId,'email');assert.notEqual(current.user.role,'ADMIN');
 await service.auth.api.signOut({headers:signed});assert.equal(await service.auth.api.getSession({headers:signed}),null);
});
test('email route cannot be enabled without an actual server mail transport',async()=>{
 const service=await createGoogleOnlyCustomerAuthService(options());assert.equal(service.auth.api.sendVerificationOTP,undefined);
 await assert.rejects(()=>createGoogleOnlyCustomerAuthService({...options(),sendVerificationOTP:true}),/CUSTOMER_AUTH_CONFIGURATION_INVALID/);
});
test('Google callback engine never exposes email OTP endpoints',async()=>{
 const service=await createGoogleOnlyCustomerAuthService({...options(),mode:'callback',sendVerificationOTP:async()=>{throw Error('callback must not send mail')}});assert.equal(service.auth.api.sendVerificationOTP,undefined);
});
