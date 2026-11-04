import {createLazyCustomerNodeHandler} from '../server/bootstrap.mjs';
const authPaths=new Set(['/api/auth/providers','/api/auth/session','/auth/start','/auth/logout','/auth/complete','/auth/email/send','/auth/email/verify']);
const allowed=path=>authPaths.has(path)||/^\/api\/customer\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)||/^\/functions\/v1\/core-customer-auth\/callback\/(google|kakao)\/oauth-proxy$/.test(path);
export function resolveCustomerDispatchUrl(raw){
 const invalid=()=>{throw Error('CUSTOMER_DISPATCH_ROUTE_INVALID')};
 if(typeof raw!=='string'||raw.length>8192||!raw.startsWith('/')||raw.startsWith('//')||/[\r\n#\\]/.test(raw))invalid();
 const url=new URL(raw,'https://dispatch.invalid'),selectors=url.searchParams.getAll('__customer_route');
 if(!selectors.length)return raw;
 if(selectors.length!==1||!allowed(selectors[0])||(url.pathname!=='/api/dispatch'&&url.pathname!==selectors[0]))invalid();
 const query=raw.includes('?')?raw.slice(raw.indexOf('?')+1).split('&'):[];
 const kept=query.filter(part=>{let key;try{key=decodeURIComponent(part.split('=')[0].replace(/\+/g,' '))}catch{invalid()}return key!=='__customer_route'});
 return selectors[0]+(kept.length?'?'+kept.join('&'):'');
}
// Only routing is normalized. The existing raw-body, origin, session and OAuth
// checks run unchanged; this selector confers no authentication or authority.
const handler=createLazyCustomerNodeHandler();
export default async function dispatch(req,res){
 try{req.url=resolveCustomerDispatchUrl(req.url)}catch{res.statusCode=400;res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');res.end('{"code":"CUSTOMER_DISPATCH_ROUTE_INVALID"}');return;}
 return handler(req,res);
}
