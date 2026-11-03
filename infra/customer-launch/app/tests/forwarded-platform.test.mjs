import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCustomerForwardedHeader} from '../server/inherited/customer-node-adapter.mjs';
const host='thefa-core-customer.vercel.app',peer='192.0.2.4';
const make=value=>new Headers({host,'x-forwarded-host':host,'x-forwarded-proto':'https','x-vercel-forwarded-for':peer,forwarded:value,cookie:'session=preserved'});
test('one consistent HTTPS forwarding hop is consumed without trusting extension signature or altering cookie',()=>{
 const h=make('for='+peer+';host='+host+';proto=https;sig=opaque==;exp=1793702995');
 normalizeCustomerForwardedHeader(h,host);assert.equal(h.has('forwarded'),false);assert.equal(h.get('cookie'),'session=preserved');assert.equal(h.get('host'),host);
});
test('forwarding cannot override pinned host, transport, platform peer or inject extra hops and duplicate keys',()=>{
 for(const value of ['for='+peer+';host=evil.test;proto=https','for='+peer+';host='+host+';proto=http','for=198.51.100.1;host='+host+';proto=https','for='+peer+';host='+host+';proto=https,for=1.2.3.4','for='+peer+';host='+host+';host='+host+';proto=https','host='+host+';proto=https','for='+peer+';host='+host+';proto=https;by=evil'])assert.throws(()=>normalizeCustomerForwardedHeader(make(value),host),/CUSTOMER_REQUEST_ORIGIN_INVALID/);
 const h=make('for='+peer+';host='+host+';proto=https');h.set('host','evil.test');assert.throws(()=>normalizeCustomerForwardedHeader(h,host));
});
