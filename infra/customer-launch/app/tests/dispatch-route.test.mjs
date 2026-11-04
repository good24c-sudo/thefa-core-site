import test from 'node:test';import assert from 'node:assert/strict';
import {resolveCustomerDispatchUrl} from '../api/dispatch.mjs';
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
