import pg from 'pg';
import {DATABASE_CA} from './database-ca.mjs';
import {AUTH_PROJECTS,AUTH_POOLER,AUTH_ROLE,AUTH_SCHEMA} from './configuration.mjs';

const bindings=new WeakMap();
const invalid=()=>{throw Object.assign(new Error('CUSTOMER_AUTH_DATABASE_CONFIGURATION_INVALID'),{code:'CUSTOMER_AUTH_DATABASE_CONFIGURATION_INVALID'})};
export const getConfiguredCoreAuthPoolBinding=pool=>bindings.get(pool)??null;

export function createConfiguredCoreAuthPool({connectionString,environment,projectRef,poolerHost}={}){
  let url;
  try{if(typeof connectionString!=='string'||connectionString.length>8192||/[\x00-\x20\x7f]/.test(connectionString))invalid();url=new URL(connectionString)}catch{invalid()}
  if(!Object.hasOwn(AUTH_PROJECTS,environment)||projectRef!==AUTH_PROJECTS[environment]||poolerHost!==AUTH_POOLER||
    url.protocol!=='postgresql:'||url.hostname!==AUTH_POOLER||url.port!=='5432'||
    url.username!==AUTH_ROLE+'.'+projectRef||url.pathname!=='/postgres'||!url.password||url.hash||
    [...url.searchParams.keys()].length!==1||url.searchParams.get('sslmode')!=='verify-full')invalid();
  url.search='';
  const pool=new pg.Pool({connectionString:url.href,ssl:{ca:DATABASE_CA,rejectUnauthorized:true,servername:AUTH_POOLER},
    options:'-c search_path='+AUTH_SCHEMA,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  bindings.set(pool,Object.freeze({environment,projectRef,role:AUTH_ROLE,schema:AUTH_SCHEMA,poolerHost:AUTH_POOLER}));return pool;
}
