import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createGoogleOnlyCustomerAuthService} from '../server/google-only-auth.mjs';
import {createCustomerPublicCompositionV2} from '../server/customer-public-composition-v2.mjs';
import {readCustomerServerConfiguration} from '../server/bootstrap.mjs';
import {FakeLeaseDatabase} from './fake-lease-database.mjs';
const origin='https://thefa-core-customer-r39.vercel.app',issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const blank=()=>({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}});
const signed=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
export function config(){return {environment:'staging',customerOrigin:origin,supabaseUrl:'https://furfjhymxqsbhvuyeqpx.supabase.co',serviceRoleKey:'isolated-service-key-not-real-00000',tenantKey:'isolated-launch-stable-tenant-key-000000',accountSecret:Buffer.alloc(32,71),allowanceSecret:Buffer.alloc(32,72),budgetSecret:Buffer.alloc(32,73),deepseekApiKey:'sk-synthetic-launch-provider-key',redirectReady:true,accountMode:'fresh-launch',usageEpoch:'launch-20261031',launchStartedAt:new Date(Date.now()-3600000).toISOString()};}
export async function setup({mail=true,emailError=false,old=false,oldMapping=false}={}){
 const cfg=config(),db=new FakeLeaseDatabase(),sent=[],counter={ai:0};
 const options={environment:cfg.environment,customerOrigin:origin,issuer,mode:'https',memory:true,secret:'synthetic-launch-auth-secret-00000000',proxySecret:'synthetic-launch-proxy-secret-0000000',google:{clientId:'fixture-google',clientSecret:'fixture-google-secret'}};
 const authService=await createGoogleOnlyCustomerAuthService({...options,...(mail?{sendVerificationOTP:async data=>{if(emailError)throw Error('MAIL_TRANSPORT_FAILURE');sent.push(data)}}:{})});
 const providerService=await createGoogleOnlyCustomerAuthService({...options,mode:'callback'});
 let oldUser;
 if(old){const ctx=await authService.auth.$context;oldUser=await ctx.internalAdapter.createUser({name:'Earlier customer',email:'earlier@example.test',emailVerified:true,createdAt:new Date(Date.now()-86400000),updatedAt:new Date()});
  if(oldMapping){const principal=createHmac('sha256',cfg.accountSecret).update(issuer+'|'+oldUser.id).digest('hex'),alias='guest_'+ 'a'.repeat(48)+'@temporary.thefa.invalid';db.prime('tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex'),{...blank(),customerAccounts:{accounts:{[principal]:{workspaceEmail:alias}},claims:{[createHmac('sha256',cfg.accountSecret).update(alias).digest('hex')]:principal},flows:{},sessions:{},attempts:{}}});}
 }
 const fetchImpl=async(url,options={})=>{const u=new URL(url);if(u.origin==='https://api.deepseek.com'){counter.ai++;return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic full-path answer '+counter.ai}}],usage:{prompt_tokens:120,completion_tokens:15}})}
  if(u.origin!==cfg.supabaseUrl)throw Error('EXTERNAL_NETWORK_FORBIDDEN_IN_QA');
  if(u.pathname.startsWith('/rest/v1/rpc/'))return Response.json(await db.rpc(u.pathname.split('/').at(-1),JSON.parse(options.body)));
  if(u.pathname==='/rest/v1/core_console_state_v3')return Response.json(await db.request('/core_console_state_v3'+u.search));throw Error('UNEXPECTED_REST_ROUTE');};
 const app=createCustomerPublicCompositionV2({config:cfg,authService,providerService,resolveLoginContext:async()=>({peer:'127.0.0.1',guestEmail:null}),fetchImpl});
 const call=async(path,body,cookie='')=>app.application(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const login=async email=>{const send=await call('/auth/email/send',{email});assert.equal(send.status,200,await send.clone().text());const code=sent.at(-1).otp;const verify=await call('/auth/email/verify',{email,otp:code});return {response:verify,cookie:signed(verify),code};};
 return {cfg,db,sent,counter,app,authService,call,login,oldUser};
}

export {origin,issuer,blank};
