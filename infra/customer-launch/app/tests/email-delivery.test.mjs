import test from 'node:test';
import assert from 'node:assert/strict';
let api={};try{api=await import('../server/email-delivery.mjs')}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const env={CUSTOMER_EMAIL_PROVIDER:'resend',CUSTOMER_EMAIL_FROM:'verification@example.test',CUSTOMER_EMAIL_API_KEY:'re_synthetic_email_transport_fixture'};
function configured(options){assert.equal(typeof api.createCustomerEmailDelivery,'function','runtime mail delivery adapter missing');return api.createCustomerEmailDelivery(options);}
test('email transport is disabled without complete server configuration and never falls back to a guessed sender',()=>{
 assert.equal(configured({env:{}}),undefined);
 assert.throws(()=>configured({env:{CUSTOMER_EMAIL_PROVIDER:'resend'}}),/EMAIL_DELIVERY_CONFIGURATION_INVALID/);
 assert.throws(()=>configured({env:{...env,CUSTOMER_EMAIL_FROM:'bad@example.test\r\nBcc: somebody@example.test'}}),/EMAIL_DELIVERY_CONFIGURATION_INVALID/);
 assert.throws(()=>configured({env:{...env,CUSTOMER_EMAIL_PROVIDER:'unknown'}}),/EMAIL_DELIVERY_CONFIGURATION_INVALID/);
});
test('actual mail adapter sends only the bounded code to configured endpoint and accepts a provider message receipt',async()=>{
 const seen=[];const deliver=configured({env,fetchImpl:async(url,init)=>{seen.push({url,init});return Response.json({id:'33333333-3333-4333-8333-333333333333'});}});
 const result=await deliver({email:'member@example.test',otp:'123456',type:'sign-in'});assert.equal(result.accepted,true);assert.equal(result.delivered,false);assert.equal(seen.length,1);
 assert.equal(seen[0].url,'https://api.resend.com/emails');assert.equal(seen[0].init.method,'POST');assert.equal(seen[0].init.redirect,'error');assert.match(seen[0].init.headers['Idempotency-Key'],/^thefa-auth-[a-f0-9-]{36}$/);
 const body=JSON.parse(seen[0].init.body);assert.equal(body.from,env.CUSTOMER_EMAIL_FROM);assert.deepEqual(body.to,['member@example.test']);assert.match(body.text,/123456/);assert.equal(body.cc,undefined);assert.equal(body.bcc,undefined);
});
test('ambiguous network result is never automatically resent and no error reveals key or code',async()=>{
 let calls=0;const deliver=configured({env,fetchImpl:async()=>{calls++;throw Error(env.CUSTOMER_EMAIL_API_KEY+' 123456');}});
 await assert.rejects(()=>deliver({email:'member@example.test',otp:'123456',type:'sign-in'}),e=>e.message==='EMAIL_DELIVERY_UNAVAILABLE'&&!String(e).includes('123456'));
 assert.equal(calls,1);
});
test('provider failure, missing acknowledgement and oversize response never become a sent success',async()=>{
 for(const response of [Response.json({id:'33333333-3333-4333-8333-333333333333'},{status:403}),Response.json({ok:true}),Response.json({id:'x'.repeat(20000)})]){
  const deliver=configured({env,fetchImpl:async()=>response});await assert.rejects(()=>deliver({email:'member@example.test',otp:'123456',type:'sign-in'}),/EMAIL_DELIVERY_UNAVAILABLE/);
 }
});
test('unsupported mail types, invalid recipients and invalid codes cannot dispatch',async()=>{
 let calls=0;const deliver=configured({env,fetchImpl:async()=>{calls++;throw Error()}});
 for(const input of [{email:'member@example.test',otp:'123456',type:'password-reset'},{email:'x@example.test,y@example.test',otp:'123456',type:'sign-in'},{email:'member@example.test',otp:'<script>',type:'sign-in'}])await assert.rejects(()=>deliver(input),/EMAIL_DELIVERY_REQUEST_INVALID/);
 assert.equal(calls,0);
});
