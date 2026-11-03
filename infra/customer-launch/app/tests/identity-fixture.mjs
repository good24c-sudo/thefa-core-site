import {generateKeyPairSync,createHmac,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createConfiguredCoreAuthPool} from '../server/inherited/server/auth/database.mjs';
export const realm='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const hash=x=>createHash('sha256').update(x).digest('hex');
const blank=()=>({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}});
export function fixture(){
 const keys={accountSecret:Buffer.alloc(32,31),allowanceSecret:Buffer.alloc(32,41),tenantKey:'isolated-r39-tenant-key-preserved-original-00000000'};
 const hmac=(key,x)=>createHmac('sha256',key).update(x).digest('hex');
 const identities=[{userId:'11111111-1111-4111-8111-111111111111',provider:'google',subject:'fixture-provider-subject-a'},{userId:'22222222-2222-4222-8222-222222222222',provider:'kakao',subject:'fixture-provider-subject-b'}];
 const registry={...blank(),customerAccounts:{accounts:{},claims:{},flows:{},sessions:{},attempts:{}}},files=new Map();
 for(let i=0;i<identities.length;i++){
  const account=hmac(keys.accountSecret,realm+'|'+identities[i].userId),email='guest_'+(i?'b':'a').repeat(48)+'@temporary.thefa.invalid';identities[i].account=account;identities[i].email=email;
  registry.customerAccounts.accounts[account]={workspaceEmail:email};registry.customerAccounts.claims[hmac(keys.accountSecret,email)]=account;
  registry.customerAccounts.claims[hmac(keys.accountSecret,'guest_'+(i?'d':'c').repeat(48)+'@temporary.thefa.invalid')]=account;
  const wid='tenant_'+hmac(keys.tenantKey,'THE_FA_CUSTOMER_TENANT_V3\0'+email),aid='tenant_'+hmac(keys.allowanceSecret,'CORE_FREE_ALLOWANCE_V1:'+account);
  files.set(wid+'.json',Buffer.from(JSON.stringify(blank())+'\n'));
  files.set(aid+'.json',Buffer.from(JSON.stringify({...blank(),customerAllowance:{version:1,used:1,requests:{[hmac(keys.allowanceSecret,'REQUEST:fixture-old-request-'+i)]:'SUCCEEDED'},completions:{}}})+'\n'));
 }
 const registryName='tenant_'+hash('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1')+'.json';files.set(registryName,Buffer.from(JSON.stringify(registry)+'\n'));files.set('account-auth-key',Buffer.from(keys.accountSecret));files.set('account-allowance-key',Buffer.from(keys.allowanceSecret));files.set('tenant-key',Buffer.from(keys.tenantKey));
 const provenance={accountSecret:{file:'account-auth-key',encoding:'raw'},allowanceSecret:{file:'account-allowance-key',encoding:'raw'},tenantKey:{file:'tenant-key',encoding:'utf8'}};
 return {keys,provenance,identities,registry,registryName,files,backup:new Map([...files].map(([k,v])=>[k,Buffer.from(v)])),...generateKeyPairSync('ed25519')};
}
export async function providerSnapshot(rows,api){
 const database=createConfiguredCoreAuthPool({environment:'staging',projectRef:'furfjhymxqsbhvuyeqpx',poolerHost:'aws-0-ap-northeast-2.pooler.supabase.com',connectionString:'postgresql://core_customer_auth_runtime.furfjhymxqsbhvuyeqpx:fixture-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full'});
 let queries=0;database.connect=async()=>({query:async sql=>{queries++;return /current_user/.test(sql)?{rows:[{role:'core_customer_auth_runtime',schema:'core_customer_auth'}]}:/from core_customer_auth/.test(sql)?{rows:rows.map(r=>({userId:r.userId,provider:r.provider,subject:r.subject}))}:{rows:[]}},release(){}});
 try{return {snapshot:await api.readCompleteProviderIdentityInventory({database}),queries}}finally{await database.end()}
}

import {createConfiguredCustomerAuthService} from '../server/inherited/server/auth/service.mjs';
import * as signupAPI from '../server/signup-classifier.mjs';
const origin='https://thefa-core-customer-r39.vercel.app';
export async function authenticatedIdentity(f,row,{keepOpen=false}={}){
 const service=await createConfiguredCustomerAuthService({environment:'staging',customerOrigin:origin,issuer:realm,mode:'https',memory:true,secret:'isolated-r39-auth-secret-32-characters',proxySecret:'isolated-r39-proxy-secret-32-characters',google:{clientId:'fixture-google',clientSecret:'fixture-google-secret'},kakao:{clientId:'fixture-kakao',clientSecret:'fixture-kakao-secret'}});
 const context=await service.auth.$context,name=context.authCookies.sessionToken.name,cookie=name+'=isolated-signed-cookie-fixture';
 service.auth.api.getSession=async({headers})=>headers.get('cookie')?.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'=')).join(';')===cookie?{session:{id:'fixture-server-session',userId:row.userId,coreProviderId:row.provider,expiresAt:new Date(Date.now()+60000)},user:{id:row.userId,email:row.email,emailVerified:row.emailVerified}}:null;
 const database=createConfiguredCoreAuthPool({environment:'staging',projectRef:'furfjhymxqsbhvuyeqpx',poolerHost:'aws-0-ap-northeast-2.pooler.supabase.com',connectionString:'postgresql://core_customer_auth_runtime.furfjhymxqsbhvuyeqpx:fixture-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full'});
 database.connect=async()=>({query:async(sql,params)=>/current_user/.test(sql)?{rows:[{role:'core_customer_auth_runtime',schema:'core_customer_auth'}]}:/join core_customer_auth/.test(sql)?(assert.deepEqual(params,[row.userId,row.provider,'fixture-server-session']),{rows:[{subject:row.subject,accountRowId:row.accountRowId}]}):{rows:[]},release(){}});
 const reader=signupAPI.createVerifiedProviderIdentityReader({authService:service,database,accountSecret:f.keys.accountSecret,identityRealm:realm});
 try{return {proof:await reader(cookie),cookie,service,readIdentity:reader,close:()=>database.end()}}finally{if(!keepOpen)await database.end()}
}
