import test from 'node:test';import assert from 'node:assert/strict';
let edge;const old=globalThis.Deno;globalThis.Deno={serve(){}};try{edge=await import('../callback-edge/index.ts')}finally{globalThis.Deno=old}
const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth',url=issuer+'/callback/google?code=opaque&state=bound';
test('the documented Supabase relay host maps only to the pinned issuer while OAuth bytes and cookie remain exact',()=>{
 const r=new Request(url,{headers:{host:'edge-runtime.supabase.com','x-forwarded-host':'edge-runtime.supabase.com','x-forwarded-proto':'https',cookie:'binding=opaque'}});
 const got=edge.normalizeCallbackPlatformRequest(r,new URL(url));assert.equal(got.url,url);assert.equal(got.headers.get('host'),new URL(issuer).host);assert.equal(got.headers.get('x-forwarded-host'),new URL(issuer).host);assert.equal(got.headers.get('cookie'),'binding=opaque');assert.equal(r.headers.get('host'),'edge-runtime.supabase.com');
});
test('unrecognized relay, forwarding authority or original-URL override stays denied',()=>{
 for(const h of [{host:'evil.example'},{host:'edge-runtime.supabase.com:80'},{host:'edge-runtime.supabase.com','x-forwarded-host':'evil.example'},{host:'edge-runtime.supabase.com','x-forwarded-proto':'http'},{host:'edge-runtime.supabase.com',forwarded:'host=evil.example'},{host:'edge-runtime.supabase.com','x-original-url':'https://evil.example'}])assert.throws(()=>edge.normalizeCallbackPlatformRequest(new Request(url,{headers:h}),new URL(url)),/CUSTOMER_AUTH_ORIGIN_INVALID/);
 assert.throws(()=>edge.normalizeCallbackPlatformRequest(new Request('https://evil.example/callback/google'),new URL(url)),/CUSTOMER_AUTH_ORIGIN_INVALID/);
});
