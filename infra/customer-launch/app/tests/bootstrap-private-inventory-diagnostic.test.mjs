import test from 'node:test';
import assert from 'node:assert/strict';
import * as bootstrap from '../server/bootstrap.mjs';

const failures=[
 ['ENOENT','INVENTORY_NOT_FOUND'],
 ['EACCES','INVENTORY_ACCESS_DENIED'],
 ['EPERM','INVENTORY_ACCESS_DENIED'],
 ['CUSTOMER_INVENTORY_REQUIRED','INVENTORY_PATH_INVALID'],
 ['SIGNED_LEGACY_INVENTORY_INVALID','INVENTORY_SIGNATURE_OR_BINDING_INVALID'],
 ['arbitrary-secret-value','INVENTORY_UNCLASSIFIED']
];
for(const [code,expected] of failures)test('private inventory diagnostics classify '+code+' without raw content',()=>{
 assert.equal(typeof bootstrap.privateInventoryDiagnostic,'function','Missing safe reason classification keeps every inventory failure indistinguishable');
 const value=bootstrap.privateInventoryDiagnostic(Object.assign(new Error('PRIVATE_ACCOUNT_PASSWORD_DO_NOT_LOG'),{code,path:'D:/secret/customer'}));
 assert.equal(value,expected);assert.doesNotMatch(value,/PASSWORD|secret|customer/);
});
test('invalid JSON is distinguished without copying its content',()=>{
 assert.equal(typeof bootstrap.privateInventoryDiagnostic,'function');
 assert.equal(bootstrap.privateInventoryDiagnostic(new SyntaxError('customer raw secret')), 'INVENTORY_JSON_INVALID');
});
test('private failure reason is bounded in server log, never public body; no init retry',async()=>{
 const log=console.error,events=[];console.error=(line)=>events.push(JSON.parse(line));let starts=0;
 try{
  const handler=bootstrap.createLazyCustomerNodeHandler({createServer:async()=>{starts++;throw Object.assign(new Error('DO_NOT_LOG_SECRET'),{diagnosticStage:'PRIVATE_INVENTORY',diagnosticReason:'INVENTORY_NOT_FOUND'});}});
  let body;for(let i=0;i<2;i++)await handler({}, {setHeader(){},end(x){body=x;}});
  assert.equal(starts,1);assert.equal(events[0].reason,'INVENTORY_NOT_FOUND');
  assert.equal(body,'{"code":"CUSTOMER_SERVER_UNAVAILABLE"}');assert.doesNotMatch(JSON.stringify(events),/DO_NOT_LOG_SECRET/);
 }finally{console.error=log;}
});
test('unknown private error reason is never reflected in logs',async()=>{
 const log=console.error,events=[];console.error=(line)=>events.push(JSON.parse(line));
 try{
  const handler=bootstrap.createLazyCustomerNodeHandler({createServer:async()=>{throw Object.assign(new Error('DO_NOT_LOG_SECRET'),{diagnosticStage:'PRIVATE_INVENTORY',diagnosticReason:'RAW_SECRET_ABC'});}});
  await handler({}, {setHeader(){},end(){}});assert.equal(events[0].reason,undefined);assert.doesNotMatch(JSON.stringify(events),/SECRET/);
 }finally{console.error=log;}
});
