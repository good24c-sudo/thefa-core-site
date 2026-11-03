import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const origin='https://thefa-core-customer-r39.vercel.app';
const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const files=['login.html','signup.html'];

const readPublic=name=>readFile(new URL('../public-source/'+name,import.meta.url),'utf8');

test('R42 renders only Google signup and login button, no Kakao button, without changing main chat',async()=>{
  for(const file of files){
    const html=await readPublic(file);
    assert.match(html,/<button\b[^>]*class="social google"[^>]*data-provider="google"[^>]*>/);
    assert.doesNotMatch(html,/data-provider="kakao"/i);
    assert.doesNotMatch(html,/<button\b[^>]*class="social kakao"/i);
    assert.match(html,/customer-login\.js/);
  }
  const homepage=await readPublic('index.html');
  assert.match(homepage,/<title>.*THE FA Core/i);
});

function dom(pathname,config={}){
  const buttons=[];
  const google={dataset:{provider:'google'},disabled:true,
    handlers:{},note:{textContent:''},
    querySelector(){return this.note},addEventListener(type,fn){this.handlers[type]=fn}};
  buttons.push(google);
  const group={querySelectorAll(){return buttons},setAttribute(){}};
  const status={textContent:'',classList:{add(){},remove(){}}};
  const guest={addEventListener(){}};
  const title={textContent:''};
  const redirect=[];
  const requested=[];
  const document={title:'',getElementById:id=>({
    'login-providers':group,'login-status':status,'continue-guest':guest,'login-title':title,
  }[id])};
  const location={pathname,hash:'',assign:url=>redirect.push(url)};
  const catalog=config.catalog||{
    issuer,providers:[
      {id:'google',enabled:true,callback:issuer+'/callback/google'},
      {id:'kakao',enabled:false,callback:issuer+'/callback/kakao'},
    ],
  };
  const fetch=async(url,options)=>{
    requested.push({url,body:options?.body});
    if(url==='/api/auth/providers')return Response.json(catalog);
    assert.equal(url,'/auth/start');
    assert.deepEqual(JSON.parse(options.body),{provider:'google'});
    return Response.json({location:config.destination||
      'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({
        client_id:'isolated-google-client',redirect_uri:issuer+'/callback/google',
        state:'r42-local-test-state-1234567890123456',
      })});
  };
  return {document,location,fetch,redirect,requested,status,google,buttons,title};
}

test('Google-only script requests only Google provider for signup and login',async()=>{
  const code=await readPublic('customer-login.js');
  for(const pathname of ['/signup','/login']){
    const x=dom(pathname);
    vm.runInNewContext(code,{document:x.document,location:x.location,fetch:x.fetch,URL,Response},{timeout:1000});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(x.google.disabled,false,pathname);
    assert.equal(x.buttons.length,1);
    await x.google.handlers.click();
    assert.deepEqual(x.requested.map(v=>v.url),['/api/auth/providers','/auth/start']);
    assert.equal(x.redirect.length,1);
    assert.equal(new URL(x.redirect[0]).origin,'https://accounts.google.com');
    assert.equal(new URL(x.redirect[0]).searchParams.get('redirect_uri'),issuer+'/callback/google');
  }
});
test('Kakao advertised enabled unexpectedly must not activate Google-only release',async()=>{
  const code=await readPublic('customer-login.js');
  const x=dom('/signup',{catalog:{issuer,providers:[
    {id:'google',enabled:true,callback:issuer+'/callback/google'},
    {id:'kakao',enabled:true,callback:issuer+'/callback/kakao'},
  ]}});
  vm.runInNewContext(code,{document:x.document,location:x.location,fetch:x.fetch,URL,Response},{timeout:1000});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.google.disabled,true);
  assert.equal(x.redirect.length,0);
  assert.equal(x.requested.length,1);
});
test('unsafe Google URL cannot silently redirect the browser',async()=>{
  const code=await readPublic('customer-login.js');
  for(const location of [
    'https://example.com/o/oauth2/v2/auth?client_id=x&state=y&redirect_uri='+encodeURIComponent(issuer+'/callback/google'),
    'http://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y&redirect_uri='+encodeURIComponent(issuer+'/callback/google'),
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y&redirect_uri='+encodeURIComponent(issuer+'/callback/kakao'),
  ]){
    const x=dom('/login',{destination:location});
    vm.runInNewContext(code,{document:x.document,location:x.location,fetch:x.fetch,URL,Response},{timeout:1000});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(x.google.disabled,false);
    await x.google.handlers.click();
    assert.equal(x.redirect.length,0,location);
  }
});
test('unavailable provider catalogue leaves Google disabled, never claims live login',async()=>{
  const code=await readPublic('customer-login.js');
  const x=dom('/login',{catalog:{issuer,providers:[]}});
  vm.runInNewContext(code,{document:x.document,location:x.location,fetch:x.fetch,URL,Response},{timeout:1000});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.google.disabled,true);
  assert.equal(x.redirect.length,0);
});

test('direct Kakao login cannot invoke account admission even when an accountAuth route is configured',async()=>{
  const {createGoogleOnlyCustomerAuthService}=await import('../server/google-only-auth.mjs');
  const {createCustomerAuthRoutes}=await import('../server/inherited/customer-auth-routes.mjs');
  const args={environment:'staging',customerOrigin:origin,issuer,
    secret:'r42-isolated-google-only-secret-32',
    proxySecret:'r42-isolated-google-only-proxy-32',
    google:{clientId:'r42-local-google-client',clientSecret:'r42-local-google-secret'},
    memory:true};
  const authService=await createGoogleOnlyCustomerAuthService({...args,mode:'https'});
  const providerService=await createGoogleOnlyCustomerAuthService({...args,mode:'callback'});
  let admitted=0;
  const accountAuth={
    async start(){admitted++;throw Error('KAKAO_ACCOUNT_ADMISSION_MUST_NOT_BE_CALLED')},
    async finish(){return null},async session(){return null},async logout(){return null},
  };
  const handler=createCustomerAuthRoutes({authService,providerService,
    customerOrigin:origin,issuer,environment:'staging',accountAuth,
    resolveLoginContext:async()=>({peer:'192.0.2.5',guestEmail:null})});
  const request=new Request(origin+'/auth/start',{method:'POST',
    headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin'},
    body:'{"provider":"kakao"}'});
  const r=await handler(request);
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{code:'LOGIN_PROVIDER_NOT_READY'});
  assert.equal(admitted,0,'No signup or OAuth work may start for Kakao');
});
