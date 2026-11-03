const PRODUCTION_ORIGIN='https://thefacore.com';
const STAGING_HOST=/^thefa-core-customer(?:-[a-z0-9-]+)?\.vercel\.app$/;
const invalid=()=>{throw new Error('CUSTOMER_ORIGIN_INVALID')};

// Only server configuration chooses the authority. Never pass request headers here.
export function validateCustomerOrigin(config={}){
 if(config===null||typeof config!=='object'||Array.isArray(config))invalid();
 const {customerOrigin,environment='production'}=config;
 if(!['production','staging'].includes(environment))invalid();
 const raw=customerOrigin===undefined&&environment==='production'?
  PRODUCTION_ORIGIN:customerOrigin;
 // Restrict the raw form before URL parsing can normalize ports, escapes or whitespace.
 if(typeof raw!=='string'||!/^https:\/\/[a-z0-9.-]+\/?$/i.test(raw))invalid();
 let url;
 try{url=new URL(raw)}catch{invalid()}
 if(environment==='production'&&url.origin!==PRODUCTION_ORIGIN)invalid();
 if(environment==='staging'&&!STAGING_HOST.test(url.hostname))invalid();
 return url.origin;
}
