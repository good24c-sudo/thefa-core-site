import test from 'node:test';
import assert from 'node:assert/strict';
import {createLazyCustomerNodeHandler} from '../server/bootstrap.mjs';

test('failed startup emits one bounded diagnostic without private error text or retry',async()=>{
 const events=[];let calls=0;const log=console.error;console.error=(...x)=>events.push(x);
 try{
  const handler=createLazyCustomerNodeHandler({createServer:async()=>{calls++;throw Object.assign(new Error('SECRET_PASSWORD_MUST_NOT_APPEAR'),{code:'PRIVATE_SECRET_CODE'});}});
  let body;await handler({}, {setHeader(){},end(value){body=value;}});
  assert.equal(calls,1);assert.equal(JSON.parse(body).code,'CUSTOMER_SERVER_UNAVAILABLE');
  assert.equal(events.length,1);assert.deepEqual(JSON.parse(events[0][0]),{code:'CUSTOMER_SERVER_INIT_FAILED',stage:'UNCLASSIFIED'});
  assert.doesNotMatch(JSON.stringify(events),/SECRET|PASSWORD/);
 }finally{console.error=log;}
});
