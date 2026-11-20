import test from 'node:test';import assert from 'node:assert/strict';
import {resolveCustomerDispatchUrl} from '../api/dispatch.mjs';
import {spawnSync} from 'node:child_process';
test('declared dispatch route restores only the public route while preserving OAuth query bytes',()=>{
 assert.equal(resolveCustomerDispatchUrl('/api/dispatch?__customer_route=/api/auth/providers'),'/api/auth/providers');
 assert.equal(resolveCustomerDispatchUrl('/api/dispatch?code=a%2Bb&__customer_route=%2Ffunctions%2Fv1%2Fcore-customer-auth%2Fcallback%2Fgoogle%2Foauth-proxy&state=x%2Fy'),'/functions/v1/core-customer-auth/callback/google/oauth-proxy?code=a%2Bb&state=x%2Fy');
 assert.equal(resolveCustomerDispatchUrl('/api/auth/session'),'/api/auth/session');
});
test('dispatch rejects duplicate, external, hidden, traversal and conflicting route selectors',()=>{
 for(const raw of ['/api/dispatch?__customer_route=/server/bootstrap.mjs','/api/dispatch?__customer_route=https://evil.test/auth/start','/api/dispatch?__customer_route=/api/auth/providers&__customer_route=/auth/start','/api/dispatch?__customer_route=/api/customer/../admin','/api/auth/providers?__customer_route=/auth/start','/api/dispatch?__customer_route=/api/customer/%252e%252e/admin'])assert.throws(()=>resolveCustomerDispatchUrl(raw),/CUSTOMER_DISPATCH_ROUTE_INVALID/);
});

test('conversation detail route accepts only an exact optional platform capture',()=>{
 const id='chat_12345678-1234-1234-1234-123456789abc',route='/api/customer/conversations/'+id;
 assert.equal(resolveCustomerDispatchUrl('/api/dispatch?__customer_route='+route),route);
 assert.equal(resolveCustomerDispatchUrl('/api/dispatch?conversationId='+id+'&__customer_route='+route),route);
 assert.equal(resolveCustomerDispatchUrl(route+'?__customer_route='+route+'&conversationId='+id),route);
 assert.equal(resolveCustomerDispatchUrl('/api/dispatch?__customer_route='+route+'&foo=bar'),route+'?foo=bar');
 for(const raw of ['/api/dispatch?__customer_route='+route+'&conversationId=wrong','/api/dispatch?__customer_route='+route+'&conversationId='+id+'&conversationId='+id,'/api/dispatch?__customer_route=/api/auth/session&conversationId='+id])assert.throws(()=>resolveCustomerDispatchUrl(raw),/CUSTOMER_DISPATCH_ROUTE_INVALID/);
});
test('Google callback rewrite preserves its code for the strict callback validator',()=>{
 assert.equal(resolveCustomerDispatchUrl('/api/dispatch?code=11111111-1111-4111-8111-111111111111&__customer_route=/auth/google/callback'),'/auth/google/callback?code=11111111-1111-4111-8111-111111111111');
});
test('managed auth preview cannot be intercepted by old staging OIDC bridge variables',()=>{
 const code=`import dispatch from ${JSON.stringify(new URL('../api/dispatch.mjs',import.meta.url).href)};const res={setHeader(){},end(body){console.log(body)}};await dispatch({url:'/api/auth/providers'},res);`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,CUSTOMER_AUTH_ENGINE:'managed-email-v1',VERCEL_ENV:'preview',THEFA_CORE_OIDC_ISSUER:'https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1',THEFA_CORE_STAGE_BRIDGE_ENABLED:'true'}});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).code,'CUSTOMER_SERVER_UNAVAILABLE');assert.match(r.stderr,/"stage":"SETTINGS"/);
});
