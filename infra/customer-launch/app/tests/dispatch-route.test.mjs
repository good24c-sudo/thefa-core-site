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
