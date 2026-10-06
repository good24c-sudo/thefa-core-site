const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../contact.js'), 'utf8');
const endpoint = 'https://formspree.io/f/mkjwwqaw';

function fixture(reply = async () => ({ok: true})) {
  const handlers = {}, calls = [], nodes = new Map();
  const names = {cfName:'name',cfCompany:'company',cfEmail:'email',cfPhone:'phone',cfTopic:'topic',cfScope:'scope',cfMessage:'message',cfWebsite:'_gotcha',cfConsent:'consent'};
  for (const id of ['contactForm','cfResult','cfDone','cfStatus','cfSubmit','cfLive','cfMailLink','cfMailHelp','cfCopy','cfCopyBox','cfCopyStatus',...Object.keys(names),...'cfName cfEmail cfMessage cfConsent'.split(' ').map(id=>id+'Err')]) {
    nodes.set(id, {id, name:names[id], value:'', textContent:'', checked:false, hidden:true, disabled:false, attributes:{},
      setAttribute(key,value){this.attributes[key]=value;}, removeAttribute(key){delete this.attributes[key];},
      focus(){nodes.focused=id;}, addEventListener(type,fn){this[type]=fn;}, select(){} });
  }
  const form=nodes.get('contactForm');
  form.action=endpoint;
  form.elements=[...Object.keys(names).map(id=>nodes.get(id)),nodes.get('cfSubmit')];
  form.addEventListener=(type,fn)=>{handlers[type]=fn;};
  form.reset=()=>{for(const field of form.elements){field.value='';field.checked=false;} handlers.reset?.({preventDefault(){}});};
  class FormData extends Map { constructor(form){super(); for(const field of form.elements){if(field.name&&!field.disabled&&(field.id!=='cfConsent'||field.checked))this.set(field.name,field.value);}} }
  const ctx={document:{getElementById:id=>nodes.get(id)},window:{},location:{search:''},URLSearchParams,Date,FormData,AbortController,setTimeout,clearTimeout,navigator:{clipboard:{writeText:async()=>{}}},fetch:async(url,options)=>{calls.push({url,options});return reply();}};
  vm.runInNewContext(source,ctx);
  const setValid=()=>{for(const [id,value] of Object.entries({cfName:'QA tester',cfCompany:'Fictional company',cfEmail:'qa@example.com',cfPhone:'010-0000-0000',cfTopic:'기술 협력 · 연동',cfScope:'화면 기준 QA',cfMessage:'가상 문의 내용입니다. 실제 고객 정보가 아닙니다.',cfConsent:'동의'}))nodes.get(id).value=value;nodes.get('cfConsent').checked=true;};
  return {nodes,calls,form,handlers,setValid,submit:()=>handlers.submit({preventDefault(){}})};
}

test('invalid fields never transmit a request',async()=>{
  const f=fixture();await f.submit();assert.equal(f.calls.length,0);assert.equal(f.nodes.focused,'cfName');
});
test('valid inquiry POSTs all fields to the existing service and reports success',async()=>{
  const f=fixture();f.setValid();await f.submit();assert.equal(f.calls.length,1);
  const {url,options}=f.calls[0];assert.equal(url,endpoint);assert.equal(options.method,'POST');assert.equal(options.headers.Accept,'application/json');
  for(const field of ['name','company','email','phone','topic','scope','message','consent'])assert.ok(options.body.get(field));
  assert.equal(options.body.get('email'),'qa@example.com');assert.equal(options.body.get('_gotcha'),'');
  assert.equal(f.nodes.get('cfResult').hidden,false);assert.equal(f.nodes.get('cfMessage').value,'');
});
test('while a request is pending repeat submits cannot send another inquiry',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>resolve=done));f.setValid();
  const pending=f.submit();assert.equal(f.calls.length,1);assert.equal(f.nodes.get('cfSubmit').disabled,true);
  await f.submit();assert.equal(f.calls.length,1);assert.equal(f.nodes.get('cfResult').hidden,true);
  resolve({ok:true});await pending;assert.equal(f.nodes.get('cfSubmit').disabled,false);
});
test('service rejection preserves the inquiry and never displays success',async()=>{
  const f=fixture(async()=>({ok:false,status:422}));f.setValid();const message=f.nodes.get('cfMessage').value;await f.submit();
  assert.equal(f.calls.length,1);assert.equal(f.nodes.get('cfResult').hidden,true);assert.equal(f.nodes.get('cfMessage').value,message);
  assert.equal(f.nodes.get('cfStatus').hidden,false);assert.equal(f.nodes.get('cfSubmit').disabled,false);
});
test('network failure preserves the inquiry without automatic retries',async()=>{
  const f=fixture(async()=>{throw new Error('offline');});f.setValid();await f.submit();
  assert.equal(f.calls.length,1);assert.equal(f.nodes.get('cfResult').hidden,true);assert.ok(f.nodes.get('cfMessage').value);assert.equal(f.nodes.get('cfSubmit').disabled,false);
});
test('honeypot input never transmits',async()=>{
  const f=fixture();f.setValid();f.nodes.get('cfWebsite').value='spam';await f.submit();assert.equal(f.calls.length,0);
});
test('generated form retains the working POST action without a mail preparation flow',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../contact.html'),'utf8');
  assert.match(html,/<form[^>]+action="https:\/\/formspree\.io\/f\/mkjwwqaw"[^>]+method="POST"/);
  assert.match(html,/문의 보내기/);assert.doesNotMatch(html,/문의 메일 준비하기|id="cfMailLink"|id="cfCopyBox"/);
});
