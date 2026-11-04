import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../public-source/guest-live.js',import.meta.url),'utf8');
function section(start,end){const a=code.indexOf(start),b=code.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return code.slice(a,b);}
const elem=()=>({textContent:'',hidden:false,disabled:false,children:[],classList:{remove(){}},append(x){this.children.push(x)},addEventListener(){}});
const tick=()=>new Promise(r=>setImmediate(r));
test('saved AI response is visible before a slow conversation readback finishes',async()=>{
 let release;const delayed=new Promise(r=>release=r),elements=new Map(),renders=[];
 const model={pendingRequestIds:new Map(),conversationId:'chat_test',conversation:null,busy:false};
 const userMessage={id:'u',role:'user',content:'question'},assistantMessage={id:'a',role:'assistant',content:'saved answer'};
 const context={model,uuid:()=> 'test',id:k=>{if(!elements.has(k))elements.set(k,elem());return elements.get(k)},sessionStorage:{removeItem(){}},
 request:async p=>p==='/api/customer/chat/send'?{userMessage,assistantMessage}:delayed,
 renderConversation:()=>renders.push(JSON.stringify(model.conversation)),renderSidebar(){},refresh:async()=>{},setConnected(){},renderAccount(){},notify(){},isDeepSeek:()=>true};
 vm.createContext(context);vm.runInContext(section('  async function submitCanaryModelMessage','  async function submitMessage'),context);
 const p=context.submitCanaryModelMessage({id:'chat_test',messages:[]},'question',{value:'question'});await tick();
 assert.ok(renders.some(x=>x?.includes('saved answer')),'durable response must paint without waiting for GET');
 release({conversation:{id:'chat_test',messages:[userMessage,assistantMessage]}});await p;
 assert.equal(model.conversation.messages.length,2);assert.equal(model.busy,false);
});
test('first question can use confirmed conversation creation without a blocking workspace refresh',async()=>{
 let refreshes=0;const model={busy:false,serverConnected:true,pendingRequestIds:new Map()};
 const context={model,uuid:()=> 'test',request:async()=>({conversation:{id:'chat_test'}}),applyConfirmedMutation(){},refresh:async()=>{refreshes++},notify(){}};
 vm.createContext(context);vm.runInContext(section('  async function action(','  async function createProject'),context);
 await context.action('conversation.create',{projectId:null},{refreshAfter:false});assert.equal(refreshes,0);
 await context.action('project.create',{title:'project'});assert.equal(refreshes,1,'other actions retain refresh');
});
test('signed-out state shows login guidance while keeping writes disabled',()=>{
 const elements=new Map();const context={model:{},id:k=>{if(!elements.has(k))elements.set(k,elem());return elements.get(k)},document:{createElement:()=>elem()},init(){}};
 vm.createContext(context);vm.runInContext(section('  function setBlockedForCustomerProduction','  function releaseHostedBlock'),context);
 context.setBlockedForCustomerProduction({message:'AUTH_REQUIRED'});
 assert.match(elements.get('readiness-notice').textContent,/로그인/);assert.doesNotMatch(elements.get('readiness-notice').textContent,/연결을 확인하지 못/);
 assert.equal(elements.get('chat-input').disabled,true);assert.equal(elements.get('readiness-notice').children[0].href,'/login');
});
test('storage failure remains blocked and is not disguised as a signed-out state',()=>{
 const elements=new Map();const context={model:{},id:k=>{if(!elements.has(k))elements.set(k,elem());return elements.get(k)},document:{createElement:()=>elem()},init(){}};
 vm.createContext(context);vm.runInContext(section('  function setBlockedForCustomerProduction','  function releaseHostedBlock'),context);
 context.setBlockedForCustomerProduction({message:'SERVER_UNAVAILABLE'});
 assert.match(elements.get('readiness-notice').textContent,/연결을 확인하지 못/);assert.equal(elements.get('chat-input').disabled,true);
});
