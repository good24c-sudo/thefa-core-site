import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAuthService, createRestDatabase, createResendSender, parseAllowedEmails } from './auth.mjs';
import { executeApi } from './engine-adapter.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const files={
  '/downloads/THEFA-Local-Setup-Windows.zip':['lab/public/downloads/THEFA-Local-Setup-Windows.zip','application/zip',false],
  '/login.html':['cloud/login.html','text/html; charset=utf-8',true],
  '/login.css':['cloud/login.css','text/css; charset=utf-8',true],
  '/login.js':['cloud/login.js','application/javascript; charset=utf-8',true],
  '/assets/THEFA_Core_Wordmark_Dark_web.svg':['lab/public/assets/THEFA_Core_Wordmark_Dark_web.svg','image/svg+xml',true],
  '/assets/PretendardVariable-subset.woff2':['lab/public/assets/PretendardVariable-subset.woff2','font/woff2',true],
  '/':['lab/public/index.html','text/html; charset=utf-8',false],
  '/index.html':['lab/public/index.html','text/html; charset=utf-8',false],
  '/styles.css':['lab/public/styles.css','text/css; charset=utf-8',false],
  '/app.js':['lab/public/app.js','application/javascript; charset=utf-8',false]
};
const problem=(status,message)=>Object.assign(new Error(message),{status});
async function jsonBody(req) {
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw problem(415,'JSON 요청만 처리할 수 있습니다.');
  if(Number(req.headers['content-length']||0)>16384)throw problem(413,'요청 내용이 너무 큽니다.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>16384)throw problem(413,'요청 내용이 너무 큽니다.');chunks.push(Buffer.from(chunk));}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch{throw problem(400,'요청 형식을 확인해 주세요.');}
}
export function createCloudHandler({origin=process.env.CORE_CONSOLE_ORIGIN,auth,engine=executeApi,env=process.env,read=path=>readFile(root+path)}={}) {
  let setupError=false;
  let allowedOrigins=new Set();
  try{
    const additional=env.CORE_CONSOLE_ORIGINS===undefined?[]:JSON.parse(env.CORE_CONSOLE_ORIGINS);
    if(!Array.isArray(additional)||additional.length>8)throw new Error('INVALID_ORIGIN_CONFIGURATION');
    for(const value of [origin,...additional]){
      if(typeof value!=='string'||value.includes('*'))throw new Error('INVALID_ORIGIN_CONFIGURATION');
      const parsed=new URL(value);
      if(parsed.protocol!=='https:'||parsed.origin!==value||parsed.username||parsed.password||parsed.port||parsed.hostname.endsWith('.'))throw new Error('INVALID_ORIGIN_CONFIGURATION');
      allowedOrigins.add(value);
    }
  }catch{setupError=true;allowedOrigins=new Set();}
  const publicOrigins=allowedOrigins.size?allowedOrigins:new Set(['https://thefa-core-console.vercel.app']);
  if(!auth)try{const allowedEmails=parseAllowedEmails(env.CORE_CONSOLE_ALLOWED_EMAILS);auth=createAuthService({origin,allowedEmails,otpSecret:env.CORE_OTP_SECRET,database:createRestDatabase({url:env.SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY}),sendEmail:createResendSender({key:env.RESEND_API_KEY,allowedEmails})});}catch{setupError=true;}
  return async(req,res)=>{
    const reply=(status,body,type='application/json; charset=utf-8')=>{res.statusCode=status;res.setHeader('content-type',type);res.end(type.startsWith('application/json')?JSON.stringify(body):body);};
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');res.setHeader('strict-transport-security','max-age=31536000');
    if(/^[a-f0-9]{40}$/.test(env.CORE_SOURCE_SHA||''))res.setHeader('x-core-source',env.CORE_SOURCE_SHA);
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host=req.headers.host;
      const requestOrigin=typeof host==='string'?`https://${host}`:null;
      const hostCount=(req.rawHeaders||[]).filter((value,index)=>index%2===0&&value.toLowerCase()==='host').length;
      // Vercel adds Forwarded metadata; it never selects the request authority.
      if(!publicOrigins.has(requestOrigin)||hostCount!==1||
        (req.headers['x-forwarded-host']!==undefined&&req.headers['x-forwarded-host']!==host)||
        (req.headers['x-forwarded-proto']!==undefined&&req.headers['x-forwarded-proto']!=='https')||
        (req.headers['x-forwarded-port']!==undefined&&req.headers['x-forwarded-port']!=='443'))return reply(403,{error:'허용된 서비스 주소에서 요청해 주세요.'});
      if(req.headers.origin!==undefined&&req.headers.origin!==requestOrigin)return reply(403,{error:'현재 사이트의 화면에서 요청해 주세요.'});
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))return reply(404,{error:'페이지를 찾지 못했습니다.'});
      const url=new URL(req.url,requestOrigin);
      const routes=url.searchParams.getAll('route');
      const path=routes.length===1?routes[0]:routes.length?null:url.pathname;
      if(!path||!path.startsWith('/')||path.includes('..')||path.includes('\\')||path.includes('%')||path.includes('?')||path.includes('#'))return reply(404,{error:'페이지를 찾지 못했습니다.'});
      if(path==='/login.html')res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if(!['GET','HEAD','POST'].includes(req.method))return reply(405,{error:'지원하지 않는 요청입니다.'});
      if(files[path]?.[2]&&['GET','HEAD'].includes(req.method)){const [file,type]=files[path];return reply(200,req.method==='HEAD'?'':await read(file),type);}
      if(setupError)return reply(503,{error:'인증 서비스 연결을 준비 중입니다.'});
      if(req.method==='POST'&&(!allowedOrigins.has(requestOrigin)||req.headers.origin!==requestOrigin||['cross-site','same-site'].includes(req.headers['sec-fetch-site'])))return reply(403,{error:'현재 사이트의 화면에서 요청해 주세요.'});
      if(path==='/auth/request-code'&&req.method==='POST'){const body=await jsonBody(req);return reply(200,await auth.requestCode(body.email));}
      if(path==='/auth/verify-code'&&req.method==='POST'){const body=await jsonBody(req);const result=await auth.verifyCode(body);res.setHeader('set-cookie',result.cookie);return reply(200,{verified:true});}
      const session=await auth.getSession(req.headers.cookie);
      if(!session){if((path==='/'||path==='/index.html')&&req.method==='GET'){res.setHeader('location','/login.html');res.statusCode=303;return res.end();}return reply(401,{error:'이메일 인증 후 참가해 주세요.'});}
      if(path==='/auth/logout'&&req.method==='POST'){res.setHeader('set-cookie',await auth.logout(req.headers.cookie));return reply(200,{loggedOut:true});}
      if(files[path]&&['GET','HEAD'].includes(req.method)){const [file,type]=files[path];return reply(200,req.method==='HEAD'?'':await read(file),type);}
      if(!path.startsWith('/api/')||req.method==='HEAD')return reply(404,{error:'페이지를 찾지 못했습니다.'});
      const output=await engine(path,req.method,req.method==='POST'?await jsonBody(req):undefined);
      for(const key of ['content-type','content-disposition'])if(output.headers?.[key])res.setHeader(key,output.headers[key]);
      if(path==='/api/state'&&output.status===200){const state=JSON.parse(output.body);state.auth={email:session.email};state.environment={...state.environment,deploymentMode:'private-beta',executionLocation:'Cloud',transport:'polling',privateBetaStorageConnected:true,businessProductionConnected:false};output.body=JSON.stringify(state);}
      res.statusCode=output.status;res.end(output.body);
    }catch(error){if(error.retryAfter)res.setHeader('retry-after',String(error.retryAfter));reply(error.status||503,{error:error.status?error.message:'서비스 요청을 처리하지 못했습니다.',...(error.retryAfter?{retryAfter:error.retryAfter}:{})});}
  };
}
