import test from 'node:test';import assert from 'node:assert/strict';
import {readCustomerServerConfiguration,createCustomerServerFromEnvironment} from '../server/bootstrap.mjs';
const base=()=>({NODEJS_HELPERS:'0',VERCEL:'1',CUSTOMER_ENVIRONMENT:'production',CUSTOMER_ORIGIN:'https://thefacore.com',CUSTOMER_SUPABASE_URL:'https://cgrppxfdurpzzfvkmfte.supabase.co',CUSTOMER_SERVICE_ROLE_KEY:'synthetic-service-only-test',CUSTOMER_TENANT_KEY:'synthetic-stable-tenant-key-at-least-32',CUSTOMER_ACCOUNT_SECRET_BASE64:Buffer.alloc(32,11).toString('base64'),CUSTOMER_ALLOWANCE_SECRET_BASE64:Buffer.alloc(32,12).toString('base64'),CUSTOMER_BUDGET_SECRET_BASE64:Buffer.alloc(32,13).toString('base64'),CUSTOMER_DEEPSEEK_API_KEY:'sk-synthetic-test-only-api-key',CUSTOMER_REDIRECTS_READY:'true',CUSTOMER_ACCOUNT_MODE:'fresh-launch',CUSTOMER_USAGE_EPOCH:'new-customer-20261117',CUSTOMER_LAUNCH_STARTED_AT:new Date(Date.now()-60000).toISOString(),CUSTOMER_AUTH_ENGINE:'managed-email-v1',CUSTOMER_AUTH_SECRET:'synthetic-private-server-session-key-32',CUSTOMER_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_12345678901234567890'});
test('managed fresh mode does not depend on missing legacy inventory/Google callback/BetterAuth DB',()=>{const s=readCustomerServerConfiguration(base());assert.equal(s.authEngine,'managed-email-v1');assert.equal(s.verificationKey,null);assert.equal(s.connectionString,null);assert.equal(s.google,undefined);});
test('managed engine is never silently enabled for a legacy preservation mode',()=>assert.throws(()=>readCustomerServerConfiguration({...base(),CUSTOMER_ACCOUNT_MODE:'legacy-preserved'}),/CUSTOMER_SERVER_CONFIGURATION_INVALID/));
test('managed fresh composition serves auth catalog and rejects anonymous workspace without 503',async()=>{
 const server=await createCustomerServerFromEnvironment({env:base(),fetchImpl:async()=>{throw Error('ANONYMOUS_READ_MUST_NOT_CALL_PROVIDER')}});
 const headers={host:'thefacore.com'};
 const p=await server.application(new Request('https://thefacore.com/api/auth/providers',{headers}));assert.equal(p.status,200);assert.equal((await p.json()).email.method,'password-confirmed');
 const s=await server.application(new Request('https://thefacore.com/api/auth/session',{headers}));assert.equal(s.status,200);assert.equal((await s.json()).authenticated,false);
 const w=await server.application(new Request('https://thefacore.com/api/customer/workspace',{headers}));assert.equal(w.status,401);
 await server.close();
});
