import test from 'node:test';
import assert from 'node:assert/strict';
const env={CUSTOMER_ENVIRONMENT:'staging',CUSTOMER_ORIGIN:'https://thefa-core-customer-r39.vercel.app'};
let handler,edge;const previous=globalThis.Deno;
globalThis.Deno={env:{get:key=>env[key]},serve:fn=>{handler=fn}};
try{edge=await import('../callback-edge/index.ts')}finally{globalThis.Deno=previous}
const invoke=async(url,method='GET')=>{
 const saved=globalThis.Deno;globalThis.Deno={env:{get:key=>env[key]}};
 try{return await handler(new Request(url,{method}))}finally{globalThis.Deno=saved}
};
test('callback rejection diagnostics contain booleans only, never headers, query, credentials or cookies',()=>{
 const r=new Request('https://example.test/callback/google?code=private-code',{headers:{host:'private-host','x-forwarded-host':'private-host','x-forwarded-proto':'http',forwarded:'private-forwarded','x-original-url':'private-path',cookie:'private-cookie'}});
 const d=edge.callbackOriginDiagnostics(r,'example.test');assert.ok(Object.values(d).every(x=>typeof x==='boolean'));assert.doesNotMatch(JSON.stringify(d),/private/);assert.equal(d.hostMatches,false);assert.equal(d.forwardedHostMatches,false);assert.equal(d.forwardedPresent,true);assert.equal(d.originalUrlPresent,true);
});
test('callback entry rejects non-GET and unsupported issuer paths before database or provider initialization',async()=>{
 for(const [url,method]of [['https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth/customer/providers','POST'],['https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth/unknown','GET'],['https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth/callback/not-google','GET']]){
  const res=await invoke(url,method);assert.equal(res.status,404);assert.deepEqual(await res.json(),{code:'NOT_FOUND'});
 }
});
test('callback entry fails closed with sanitized response when actual dedicated connection is missing',async()=>{
 const res=await invoke('https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth/customer/providers');assert.equal(res.status,503);assert.deepEqual(await res.json(),{code:'CORE_CUSTOMER_AUTH_UNAVAILABLE'});
});
test('deferred Kakao callback rejects before credentials or database initialization',async()=>{
 let secretReads=0;const saved=globalThis.Deno;globalThis.Deno={env:{get:key=>{if(key.startsWith('CORE_CUSTOMER_')){secretReads++;throw Error('DEFERRED_PROVIDER_MUST_NOT_READ_CREDENTIALS')}return env[key]}}};
 try{const response=await handler(new Request('https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth/callback/kakao?code=isolated&state=isolated'));assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'LOGIN_PROVIDER_NOT_READY'});assert.equal(secretReads,0)}finally{globalThis.Deno=saved}
});
