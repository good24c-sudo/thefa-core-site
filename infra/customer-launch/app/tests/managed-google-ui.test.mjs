import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public-source/customer-login.js',import.meta.url),'utf8');
const origin='https://thefacore.com',issuer='https://cgrppxfdurpzzfvkmfte.supabase.co/auth/v1';
const catalog=()=>({issuer,accountMode:'fresh-launch',email:{enabled:true,method:'password-confirmed'},providers:[{id:'google',enabled:true,flow:'supabase-pkce',provider:'custom:google',callback:origin+'/auth/google/callback'},{id:'kakao',enabled:false}]});
const destination=()=>{const u=new URL(issuer+'/authorize');u.search=new URLSearchParams({provider:'custom:google',redirect_to:origin+'/auth/google/callback',code_challenge:'a'.repeat(43),code_challenge_method:'s256',scopes:'openid email profile',prompt:'select_account'});return u;};
async function browser({signup=false,hash='',providers=catalog(),target=destination().href}={}){
 const element=()=>({hidden:false,disabled:true,value:'',textContent:'',handlers:{},classList:{add(){},remove(){}},setAttribute(){},focus(){},reportValidity(){return true},querySelector(){return {hidden:false,textContent:''}},addEventListener(k,f){this.handlers[k]=f}});
 const names=['login-status','login-title','continue-guest','email-login-form','email-address','email-code','email-send-code','email-verify-code','email-status','email-code-row','email-password','email-password-confirm','managed-password-fields','managed-password-confirm-row','auth-method-note','auth-email-availability','email-recover','password-reset-form'];
 const ids=Object.fromEntries(names.map(k=>[k,element()])),intro=element(),google=element();google.dataset={provider:'google'};
 ids['login-providers']={querySelectorAll:()=>[google],setAttribute(){}};
 const calls=[],redirects=[],historyCalls=[];
 const fetch=async(route,opt)=>{calls.push(route);if(route==='/api/auth/providers')return Response.json(providers);if(route==='/auth/start'){assert.deepEqual(JSON.parse(opt.body),{provider:'google'});return Response.json({location:target});}throw Error('UNEXPECTED_EMAIL_OR_LEGACY_REQUEST');};
 vm.runInNewContext(source,{document:{title:'',getElementById:k=>ids[k]??null,querySelector:()=>intro},location:{origin,pathname:signup?'/signup':'/login',hash,search:'',assign:p=>redirects.push(p)},history:{replaceState:(...args)=>historyCalls.push(args)},fetch,URL,URLSearchParams},{timeout:1000});
 await new Promise(r=>setImmediate(r));return {ids,intro,google,calls,redirects,historyCalls};
}
test('both real login-page clients show Google first with no separate email confirmation step',async()=>{
 for(const signup of [false,true]){const x=await browser({signup});assert.equal(x.google.hidden,false);assert.equal(x.google.disabled,false);assert.match(x.intro.textContent,/별도 비밀번호나 이메일 인증은 필요하지 않습니다/);await x.google.handlers.click();assert.deepEqual(x.redirects,[destination().href]);assert.deepEqual(x.calls,['/api/auth/providers','/auth/start']);}
});
test('Google client rejects foreign issuers, legacy route, altered callbacks, broad scopes and duplicate parameters',async()=>{
 const bad=[];
 for(const [key,value] of [['provider','google'],['redirect_to','https://evil.test'],['scopes','openid email profile https://www.googleapis.com/auth/drive'],['code_challenge_method','plain']]){const u=destination();u.searchParams.set(key,value);bad.push(u.href);}
 const dup=destination();dup.searchParams.append('provider','custom:google');bad.push(dup.href,'https://evil.test/authorize','https://accounts.google.com/o/oauth2/v2/auth?client_id=old');
 for(const target of bad){const x=await browser({target});await x.google.handlers.click();assert.deepEqual(x.redirects,[]);assert.match(x.ids['login-status'].textContent,/로그인을 시작하지 못했습니다/);}
});
test('invalid provider catalogs stay unavailable',async()=>{
 for(const providers of [{...catalog(),issuer:'https://attacker.example/auth/v1'},{...catalog(),providers:[catalog().providers[0],catalog().providers[0]]},{...catalog(),providers:[{...catalog().providers[0],provider:'google'},catalog().providers[1]]}]){const x=await browser({providers});assert.equal(x.google.disabled,true);assert.equal(x.google.hidden,true);assert.deepEqual(x.redirects,[]);}
});
test('Google callback failures are readable and removed from the browser URL',async()=>{
 const x=await browser({hash:'#google-cancelled'});assert.match(x.ids['login-status'].textContent,/취소했습니다/);assert.equal(x.historyCalls.length,1);assert.equal(x.historyCalls[0][2],'/login');assert.deepEqual(x.calls,['/api/auth/providers']);
});
