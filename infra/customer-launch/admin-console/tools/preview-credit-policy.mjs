// Isolated UI fixture only. Never included in either deployment.
// All auth, membership, pricing writes and payments below are synthetic/in-memory.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createCloudHandler} from '../cloud/server.mjs';
import {aggregateCustomerOperations} from '../cloud/customer-operations.mjs';
import {createPricingPolicyService} from '../cloud/shared/customer-pricing-policy.mjs';
import {FakeLeaseDatabase} from '../../app/tests/fake-lease-database.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),host='127.0.0.1:8894',origin='http://'+host;
const db=new FakeLeaseDatabase(),pricingPolicyService=createPricingPolicyService({rest:db});
const cookie='thefa_qa_preview=synthetic-only';
const auth={
 getSession:async header=>header?.includes(cookie)?{email:'qa@example.test'}:null,
 verifyPassword:async ({email,password})=>{
  if(email!=='qa@example.test'||password!=='synthetic-ui-test')throw Object.assign(Error('격리 검사 계정을 입력해 주세요.'),{status:401});
  return {cookie:cookie+'; Path=/; HttpOnly; SameSite=Strict'};
 },
 requestCode:async()=>{throw Object.assign(Error('격리 화면은 메일을 발송하지 않습니다.'),{status:503});},
 logout:async()=> 'thefa_qa_preview=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
};
const banner='<div style="padding:10px 18px;background:#51402c;color:#fff;text-align:center;font:13px sans-serif">격리 검증 화면 · 실제 인증·결제·운영 데이터 연결 없음</div>';
const handler=createCloudHandler({origin:'https://app.thefacore.com',env:{},auth,pricingPolicyService,
 customerOperations:async()=>aggregateCustomerOperations([]),
 engine:async()=>{throw Error('NO_EXECUTION_ENGINE_IN_UI_FIXTURE');},
 read:async path=>{const content=await readFile(root+path);return path.endsWith('.html')?content.toString().replace(/<body>/,'<body>'+banner):content;}
});
const server=createServer((req,res)=>{
 if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==origin)){res.writeHead(403);res.end();return;}
 // Adapter for a loopback-only fixture; the deployed handler retains its HTTPS policy.
 req.headers.host='app.thefacore.com';
 if(req.headers.origin)req.headers.origin='https://app.thefacore.com';
 for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()==='host')req.rawHeaders[i+1]='app.thefacore.com';
 handler(req,res);
});
server.listen(8894,'127.0.0.1',()=>console.log('THEFA_SYNTHETIC_UI_PREVIEW_READY http://127.0.0.1:8894/login.html'));
// Bounded verification helper, never a production process or replay of an old Job.
setTimeout(()=>server.close(()=>process.exit(0)),30*60*1000).unref();
