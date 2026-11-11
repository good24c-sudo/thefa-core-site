import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createStageCustomerAuthProbe,CLIENT_ID,IDP_URL,ISSUER} from '../../edge/thefa-core-customer-sso-stage/runtime.mjs';
const epoch=1760000500,sub='11111111-1111-4111-8111-111111111111';
const sessionId='77777777-7777-4777-8777-777777777777';
const env={SUPABASE_URL:IDP_URL,SUPABASE_ANON_KEY:'sb_publishable_'+('x'.repeat(31))};
const defaults={sub,role:'authenticated',aud:'authenticated',client_id:CLIENT_ID,
 session_id:sessionId,iss:ISSUER,iat:epoch-60,exp:epoch+1200};
const token=(overrides={})=>{
 const payload={...defaults,...overrides};
 return [Buffer.from('{"alg":"ES256","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'A'.repeat(86)].join('.');
};
const url=IDP_URL+'/functions/v1/thefa-core-customer-sso-stage';
const req=(jwt=token(),target=url,method='GET',extra={})=>new Request(target,{method,headers:{authorization:'Bearer '+jwt,...extra}});
const now=()=>epoch*1000;
function fakeFetch({status=200,user={id:sub,aud:'authenticated',is_anonymous:false}}={}){
 let calls=0;
 const invoke=async(endpoint,options)=>{
  calls++;
  assert.equal(endpoint,ISSUER+'/user');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.apikey,env.SUPABASE_ANON_KEY);
  assert.match(options.headers.authorization,/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return Response.json(user,{status});
 };
 return {invoke,calls:()=>calls};
}
test('Core OAuth token with exact client is verified by Auth user endpoint, identity only',async()=>{
 const f=fakeFetch(),h=createStageCustomerAuthProbe({env,fetcher:f.invoke,now});
 const response=await h(req());
 assert.equal(response.status,200);
 const out=await response.json();
 assert.deepEqual(out,{contract:'THEFA_CORE_VERIFIED_OAUTH_IDENTITY_STAGE_V1',
  authenticated:true,issuer:ISSUER,clientId:CLIENT_ID,subject:sub,
  accountLinked:false,canUseAi:false,scope:'IDENTITY_ONLY'});
 assert.equal(f.calls(),1);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 assert.match(response.headers.get('cache-control'),/no-store/);
});
test('An OAuth token of any other registered client cannot reuse Core account bridge',async()=>{
 const f=fakeFetch();
 const res=await createStageCustomerAuthProbe({env,fetcher:f.invoke,now})(req(token({client_id:'99999999-9999-4999-8999-999999999999'})));
 assert.equal(res.status,403);assert.equal(f.calls(),0);
});
test('Anonymous, missing, fake, and expired JWTs are rejected before backend',async()=>{
 const f=fakeFetch(),h=createStageCustomerAuthProbe({env,fetcher:f.invoke,now});
 for(const bad of [undefined,'notajwt',token({exp:epoch-1}),token({role:'anon'}),token({aud:'service_role'}),token({iss:'https://other.example'}),token({sub:'not-a-uuid'})]){
  const target=bad===undefined?new Request(url):req(bad);
  const res=await h(target);assert.ok([401,403].includes(res.status));
 }
 assert.equal(f.calls(),0);
});
test('Independent Auth rejection cannot authenticate a valid-shape token',async()=>{
 const f=fakeFetch({status:401,user:{message:'Invalid JWT'}});
 const r=await createStageCustomerAuthProbe({env,fetcher:f.invoke,now})(req());
 assert.equal(r.status,401);assert.equal(f.calls(),1);
});
test('Valid-looking JWT with different user returned by Auth server is rejected',async()=>{
 const f=fakeFetch({user:{id:'22222222-2222-4222-8222-222222222222',aud:'authenticated'}});
 const r=await createStageCustomerAuthProbe({env,fetcher:f.invoke,now})(req());
 assert.equal(r.status,403);
});
test('Anonymous user returned by Auth server is rejected',async()=>{
 const f=fakeFetch({user:{id:sub,aud:'authenticated',is_anonymous:true}});
 const r=await createStageCustomerAuthProbe({env,fetcher:f.invoke,now})(req());
 assert.equal(r.status,403);
});
test('Different Supabase project or absent publishable Auth key fails closed',async()=>{
 const f=fakeFetch();
 const h=createStageCustomerAuthProbe({env:{SUPABASE_URL:'https://anotherproject.supabase.co',SUPABASE_ANON_KEY:env.SUPABASE_ANON_KEY},fetcher:f.invoke,now});
 assert.equal((await h(req())).status,503);
 assert.equal((await createStageCustomerAuthProbe({env:{},fetcher:f.invoke,now})(req())).status,503);
 assert.equal(f.calls(),0);
});
test('Reject POST and unexpected function paths before Auth service call',async()=>{
 const f=fakeFetch(),h=createStageCustomerAuthProbe({env,fetcher:f.invoke,now});
 assert.equal((await h(req(token(),url,'POST'))).status,405);
 assert.equal((await h(req(token(),IDP_URL+'/functions/v1/other'))).status,404);
 assert.equal((await h(req(token(),'https://evil.example/functions/v1/unknown-function'))).status,404);
 assert.equal((await h(req(token(),url,'GET',{origin:'https://evil.example'}))).status,403);
 assert.equal(f.calls(),0);
});
test('Unavailable Auth service never becomes a successful identity result',async()=>{
 const h=createStageCustomerAuthProbe({env,fetcher:async()=>{throw Error('OFFLINE')},now});
 const r=await h(req());
 assert.equal(r.status,503);assert.equal((await r.json()).code,'STAGING_AUTH_VERIFICATION_UNAVAILABLE');
});
test('Edge source contains neither service_role usage nor DB write endpoints',async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url));
 const body=await readFile(path.resolve(root,'../../edge/thefa-core-customer-sso-stage/runtime.mjs'),'utf8');
 const entry=await readFile(path.resolve(root,'../../edge/thefa-core-customer-sso-stage/index.ts'),'utf8');
 assert.doesNotMatch(body,/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|\/rest\/v1|\/rpc\/|POST\s*\(/);
 assert.match(entry,/Deno\.serve\(createStageCustomerAuthProbe/);
 assert.match(entry,/verify_jwt=true/);
});

test('Supabase Edge rewritten internal origin and exact function path are accepted',async()=>{
 const f=fakeFetch(),h=createStageCustomerAuthProbe({env,fetcher:f.invoke,now});
 const result=await h(req(token(),'http://edge.internal/thefa-core-customer-sso-stage'));
 assert.equal(result.status,200);
 assert.equal((await result.json()).canUseAi,false);
 assert.equal(f.calls(),1);
});
