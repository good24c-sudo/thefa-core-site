import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createCloudHandler} from '../server.mjs';
import {createPricingPolicyService,DEFAULT_PRICING_POLICY} from '../shared/customer-pricing-policy.mjs';
import {FakeLeaseDatabase} from '../../../app/tests/fake-lease-database.mjs';
const origin='https://app.thefacore.com';
async function fixture(t){
 const db=new FakeLeaseDatabase(),pricingPolicyService=createPricingPolicyService({rest:db});let passwordCalls=0,engineCalls=0;
 const auth={getSession:async cookie=>cookie==='qa=test'?{email:'ceo@thefa.kr'}:null,
  verifyPassword:async()=>{passwordCalls++;return {cookie:'__Host-thefa_core_session=synthetic-only; HttpOnly; Secure; SameSite=Lax',token:'must-not-leak'};}};
 const server=createServer(createCloudHandler({origin,env:{},auth,pricingPolicyService,customerOperations:async()=>({}),engine:async()=>{engineCalls++;throw Error('unrelated engine');}}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const call=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{host:'app.thefacore.com',...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,json:text?JSON.parse(text):null,text});});
  });req.on('error',reject);req.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));
 });
 return {call,db,pricingPolicyService,passwordCalls:()=>passwordCalls,engineCalls:()=>engineCalls};
}
const headers={origin,'content-type':'application/json','sec-fetch-site':'same-origin',cookie:'qa=test'};
const body={expectedVersion:DEFAULT_PRICING_POLICY.version,requestId:'pricing-http-update-01',config:{markupBps:25000,minimumChargeCredits:1,fxKrwPerUsd:1600,standardMonthlyCredits:19000,proMonthlyCredits:49000}};
test('price changes require authenticated exact-origin JSON and never reach the execution engine',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('/api/pricing-policy')).status,401);
 for(const bad of [{...headers,cookie:''},{...headers,origin:'https://evil.example'},{...headers,'sec-fetch-site':'same-site'},{...headers,origin:undefined}]){
  // Node rejects undefined headers; omission models a missing Origin.
  const h=Object.fromEntries(Object.entries(bad).filter(([,v])=>v!==undefined));
  const r=await f.call('/api/pricing-policy',{method:'POST',headers:h,body});assert.ok([401,403].includes(r.status));
 }
 assert.equal((await f.pricingPolicyService.read()).policy.revision,0);assert.equal(f.engineCalls(),0);
});
test('authenticated policy save, stale browser conflict and readback show one persisted revision',async t=>{
 const f=await fixture(t),saved=await f.call('/api/pricing-policy',{method:'POST',headers,body});
 assert.equal(saved.status,200);assert.equal(saved.json.policy.markupBps,25000);
 const replay=await f.call('/api/pricing-policy',{method:'POST',headers,body});assert.equal(replay.status,200);assert.equal(replay.json.reused,true);
 assert.equal((await f.call('/api/pricing-policy',{method:'POST',headers,body:{...body,requestId:'pricing-http-update-02'}})).status,409);
 assert.equal((await f.call('/api/pricing-policy',{method:'POST',headers,body:{...body,workspaceId:'foreign'}})).status,400);
 const read=await f.call('/api/pricing-policy',{headers:{cookie:'qa=test'}});
 assert.equal(read.json.policy.revision,1);assert.equal(read.json.history.length,1);
 assert.equal(read.headers['cache-control'],'no-store');assert.doesNotMatch(read.text,/ceo@thefa.kr/);assert.equal(f.engineCalls(),0);
});
test('password route validates CSRF and only returns verified plus cookie; extra auth claims are rejected',async t=>{
 const f=await fixture(t);
 for(const h of [{...headers,origin:'https://thefacore.com'},{...headers,'sec-fetch-site':'cross-site'}]){
  assert.equal((await f.call('/auth/password-login',{method:'POST',headers:h,body:{email:'ceo@thefa.kr',password:'synthetic-only'}})).status,403);
 }
 assert.equal(f.passwordCalls(),0);
 assert.equal((await f.call('/auth/password-login',{method:'POST',headers,body:{email:'ceo@thefa.kr',password:'synthetic-only',verified:true}})).status,400);
 const result=await f.call('/auth/password-login',{method:'POST',headers,body:{email:'ceo@thefa.kr',password:'synthetic-only'}});
 assert.equal(result.status,200);assert.deepEqual(result.json,{verified:true});assert.doesNotMatch(result.text,/synthetic|token|password/);
 assert.equal(f.passwordCalls(),1);assert.ok(result.headers['set-cookie']);
 const native=await f.call('/auth/password-login',{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded'},body:'username=test&password=synthetic'});
 assert.equal(native.status,415);
});
