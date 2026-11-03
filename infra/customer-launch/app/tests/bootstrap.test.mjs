import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Readable} from 'node:stream';
import path from 'node:path';
import net from 'node:net';
let api={};try{api=await import('../server/bootstrap.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
const origin='https://thefa-core-customer-r39.vercel.app';
function fixture(){
 const {publicKey}=generateKeyPairSync('ed25519');
 return {CUSTOMER_ENVIRONMENT:'staging',CUSTOMER_ORIGIN:origin,NODEJS_HELPERS:'0',VERCEL:'1',
  CUSTOMER_SUPABASE_URL:'https://furfjhymxqsbhvuyeqpx.supabase.co',CUSTOMER_SERVICE_ROLE_KEY:'isolated-fixture-service-role',
  CUSTOMER_TENANT_KEY:'isolated-fixture-tenant-key-at-least32',CUSTOMER_ACCOUNT_SECRET_BASE64:Buffer.alloc(32,1).toString('base64'),
  CUSTOMER_ALLOWANCE_SECRET_BASE64:Buffer.alloc(32,2).toString('base64'),CUSTOMER_BUDGET_SECRET_BASE64:Buffer.alloc(32,3).toString('base64'),
  CUSTOMER_DEEPSEEK_API_KEY:'sk-isolated-fixture-deepseek-key',CUSTOMER_AUTH_DATABASE_URL:'postgresql://core_customer_auth_runtime.furfjhymxqsbhvuyeqpx:isolated-fixture-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full',
  CUSTOMER_AUTH_SECRET:'isolated-fixture-auth-secret-32-characters',CUSTOMER_AUTH_PROXY_SECRET:'isolated-fixture-proxy-secret-32-characters',
  CUSTOMER_GOOGLE_CLIENT_ID:'isolated-fixture-google-id',CUSTOMER_GOOGLE_CLIENT_SECRET:'isolated-fixture-google-secret',
  CUSTOMER_KAKAO_CLIENT_ID:'isolated-fixture-kakao-id',CUSTOMER_KAKAO_CLIENT_SECRET:'isolated-fixture-kakao-secret',
  CUSTOMER_REDIRECTS_READY:'true',CUSTOMER_MIGRATION_DIRECTORY:path.resolve('private-fixture-not-provisioned'),
  CUSTOMER_MIGRATION_PUBLIC_KEY_SPKI_BASE64:publicKey.export({type:'spki',format:'der'}).toString('base64')};
}
test('explicit server configuration keeps staging issuer and all three stable keys distinct',()=>{
 assert.equal(typeof api.readCustomerServerConfiguration,'function');
 const got=api.readCustomerServerConfiguration(fixture());
 assert.equal(got.config.customerOrigin,origin);assert.equal(got.issuer,'https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth');
 assert.equal(got.config.accountSecret.length,32);assert.notDeepEqual(got.config.accountSecret,got.config.allowanceSecret);assert.notDeepEqual(got.config.budgetSecret,got.config.allowanceSecret);
 assert.equal(got.config.redirectReady,true);assert.equal(got.config.environment,'staging');
});
test('bundled private migration snapshots resolve from function working directory when no absolute override is set',()=>{
 const env=fixture();delete env.CUSTOMER_MIGRATION_DIRECTORY;
 assert.equal(api.readCustomerServerConfiguration(env).receiptDirectory,path.resolve('private-data/migration'));
});
test('missing, parsed-body, cross-project and reused-key settings reject with sanitized diagnostics',()=>{
 assert.equal(typeof api.readCustomerServerConfiguration,'function');
 const cases=[e=>delete e.CUSTOMER_SERVICE_ROLE_KEY,e=>e.NODEJS_HELPERS='1',e=>e.CUSTOMER_SUPABASE_URL='https://cgrppxfdurpzzfvkmfte.supabase.co',e=>e.CUSTOMER_ORIGIN='https://app.thefacore.com',e=>e.CUSTOMER_BUDGET_SECRET_BASE64=e.CUSTOMER_ALLOWANCE_SECRET_BASE64,e=>e.CUSTOMER_MIGRATION_PUBLIC_KEY_SPKI_BASE64='PRIVATE-SECRET-DO-NOT-PRINT',e=>e.CUSTOMER_REDIRECTS_READY='false'];
 for(const change of cases){const env=fixture();change(env);assert.throws(()=>api.readCustomerServerConfiguration(env),error=>error.message==='CUSTOMER_SERVER_CONFIGURATION_INVALID'&&!JSON.stringify(error).includes('PRIVATE-SECRET'));}
});
test('Vercel login context only accepts a single platform client IP and never browser guest identity',async()=>{
 assert.equal(typeof api.createVercelLoginContext,'function');const resolver=api.createVercelLoginContext({VERCEL:'1'});
 assert.deepEqual(await resolver(new Request(origin+'/auth/start',{headers:{'x-vercel-forwarded-for':'2001:db8::1','x-guest-email':'attacker@example.test'}})),{peer:'2001:db8::1',guestEmail:null});
 for(const headers of [{},{'x-forwarded-for':'192.0.2.1'},{'x-vercel-forwarded-for':'192.0.2.1, 192.0.2.2'},{'x-vercel-forwarded-for':'not-an-ip'}])await assert.rejects(()=>resolver(new Request(origin+'/auth/start',{headers})),/CUSTOMER_LOGIN_CONTEXT_REQUIRED/);
 assert.throws(()=>api.createVercelLoginContext({VERCEL:'0'}),/CUSTOMER_PLATFORM_REQUIRED/);
});
test('lazy live entrypoint never leaks failed constructor config and does not replay initialization',async()=>{
 assert.equal(typeof api.createLazyCustomerNodeHandler,'function');let calls=0;
 const handler=api.createLazyCustomerNodeHandler({createServer:async()=>{calls++;throw Error('private-fixture-password')}});
 for(let i=0;i<2;i++){const req=Readable.from([]);Object.assign(req,{url:'/api/customer/workspace',method:'GET',rawHeaders:['host',new URL(origin).host]});let bytes;const headers=new Map(),res={setHeader:(k,v)=>headers.set(k,v),end:b=>{bytes=b}};await handler(req,res);assert.equal(res.statusCode,503);assert.equal(JSON.parse(bytes).code,'CUSTOMER_SERVER_UNAVAILABLE');assert.equal(String(bytes).includes('private-fixture'),false);}
 assert.equal(calls,1);
});
test('lazy entrypoint uses constructed handler for exact raw path without adding query or identity',async()=>{
 assert.equal(typeof api.createLazyCustomerNodeHandler,'function');let calls=0,seen;
 const handler=api.createLazyCustomerNodeHandler({createServer:async()=>{calls++;return{nodeHandler:async(req,res)=>{seen=req;res.statusCode=204;res.end()}}}});
 const req=Readable.from([]);Object.assign(req,{url:'/api/customer/conversations/chat_00000000-0000-0000-0000-000000000000',method:'GET'});await handler(req,{end(){}});assert.equal(seen,req);assert.equal(calls,1);
});
test('failed output after response completion never writes a second response',async()=>{
 assert.equal(typeof api.createLazyCustomerNodeHandler,'function');let ends=0;
 const handler=api.createLazyCustomerNodeHandler({createServer:async()=>({nodeHandler:async(_req,res)=>{res.writableEnded=true;throw Error('isolated-client-disconnected')}})});
 await handler({}, {writableEnded:false,end(){ends++},setHeader(){}});assert.equal(ends,0);
});
test('actual pinned auth factories fail closed when required hosted schema check cannot reach DB',async()=>{
 assert.equal(typeof api.createCustomerServerFromEnvironment,'function');
 const pg=(await import('pg')).default,originalConnect=pg.Pool.prototype.connect,originalSocket=net.Socket.prototype.connect;let poolAttempts=0,networkAttempts=0;
 pg.Pool.prototype.connect=function(){poolAttempts++;return Promise.reject(Error('PRIVATE-FIXTURE-DATABASE-DENIED'))};
 net.Socket.prototype.connect=function(){networkAttempts++;throw Error('ISOLATED_NETWORK_FORBIDDEN')};
 try{
  await assert.rejects(()=>api.createCustomerServerFromEnvironment({env:fixture(),fetchImpl:async()=>{throw Error('ISOLATED_PROVIDER_FORBIDDEN')}}),error=>error.message==='CUSTOMER_SERVER_CONFIGURATION_INVALID'&&!String(error.stack).includes('PRIVATE-FIXTURE'));
  assert.ok(poolAttempts>0);assert.equal(networkAttempts,0);
 }finally{pg.Pool.prototype.connect=originalConnect;net.Socket.prototype.connect=originalSocket}
});
