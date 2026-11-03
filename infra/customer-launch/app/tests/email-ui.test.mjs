import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const source=await readFile(new URL('../public-source/customer-login.js',import.meta.url),'utf8');
async function browser({enabled=true,sendFails=false}={}){
 const element=()=>({hidden:false,disabled:true,value:'',textContent:'',handlers:{},classList:{add(){},remove(){}},setAttribute(){},focus(){},checkValidity(){return true},reportValidity(){return true},addEventListener(k,v){this.handlers[k]=v}});
 const ids=Object.fromEntries(['login-status','login-title','continue-guest','email-login-form','email-address','email-code','email-send-code','email-verify-code','email-status','email-code-row'].map(k=>[k,element()]));
 const google=element();google.dataset={provider:'google'};google.querySelector=()=>({textContent:''});ids['login-providers']={querySelectorAll:()=>[google],setAttribute(){}};
 const calls=[],redirects=[];ids['email-address'].value='staff@thefa.kr';ids['email-code'].value='123456';
 const fetch=async(route,opt)=>{calls.push({route,body:opt?.body?JSON.parse(opt.body):null});if(route==='/api/auth/providers')return Response.json({issuer,email:{enabled},providers:[{id:'google',enabled:true,callback:issuer+'/callback/google'},{id:'kakao',enabled:false,callback:issuer+'/callback/kakao'}]});
  if(route==='/auth/email/send')return Response.json(sendFails?{code:'EMAIL_DELIVERY_UNAVAILABLE'}:{success:true,expiresIn:300},{status:sendFails?503:200});
  if(route==='/auth/email/verify')return Response.json({success:true,authenticated:true,redirect:'/'});throw Error('Unexpected route');};
 vm.runInNewContext(source,{document:{title:'',getElementById:k=>ids[k]},location:{pathname:'/signup',hash:'',assign:p=>redirects.push(p)},fetch,URL},{timeout:1000});await new Promise(r=>setImmediate(r));return {ids,calls,redirects};
}
test('actual signup and login pages have labelled email and single-use code controls',async()=>{
 for(const name of ['login.html','signup.html']){const html=await readFile(new URL('../public-source/'+name,import.meta.url),'utf8');assert.match(html,/id="email-login-form"/);assert.match(html,/id="email-address"/);assert.match(html,/autocomplete="one-time-code"/);assert.doesNotMatch(html,/data-provider="kakao"/);}
});
test('actual login client sends email request, verifies code, then navigates only to root',async()=>{
 const x=await browser();assert.equal(x.ids['email-send-code'].disabled,false);assert.equal(typeof x.ids['email-send-code'].handlers.click,'function');
 await x.ids['email-send-code'].handlers.click({preventDefault(){}});assert.deepEqual(x.calls.at(-1),{route:'/auth/email/send',body:{email:'staff@thefa.kr'}});assert.equal(x.ids['email-code-row'].hidden,false);
 await x.ids['email-login-form'].handlers.submit({preventDefault(){}});assert.deepEqual(x.calls.at(-1),{route:'/auth/email/verify',body:{email:'staff@thefa.kr',otp:'123456'}});assert.deepEqual(x.redirects,['/']);
});
test('delivery failure never displays code sent and leaves verification unavailable',async()=>{
 const x=await browser({sendFails:true});assert.equal(typeof x.ids['email-send-code'].handlers.click,'function');await x.ids['email-send-code'].handlers.click({preventDefault(){}});
 assert.equal(x.ids['email-verify-code'].disabled,true);assert.doesNotMatch(x.ids['email-status'].textContent,/보냈습니다/);assert.match(x.ids['email-status'].textContent,/발송을 확인하지 못했습니다/);assert.equal(x.redirects.length,0);
});
test('server-disabled email stays unavailable even when Google is configured',async()=>{const x=await browser({enabled:false});assert.equal(x.ids['email-send-code'].disabled,true);assert.equal(x.ids['email-verify-code'].disabled,true);});
