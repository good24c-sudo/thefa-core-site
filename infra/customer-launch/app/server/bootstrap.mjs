import {attachDatabasePool} from '@vercel/functions';
export function attachCustomerVercelPool(pool){attachDatabasePool(pool);}
import {createPublicKey} from 'node:crypto';
import {createCustomerEmailDelivery} from './email-delivery.mjs';
import {isIP} from 'node:net';
import path from 'node:path';
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {validateCustomerOrigin} from './inherited/customer-origin-policy.mjs';
const invalid=()=>{throw Object.assign(new Error('CUSTOMER_SERVER_CONFIGURATION_INVALID'),{code:'CUSTOMER_SERVER_CONFIGURATION_INVALID'})};
const projectRefs={staging:'furfjhymxqsbhvuyeqpx',production:'cgrppxfdurpzzfvkmfte'};
const diagnosticStages=new Set(['SETTINGS','AUTH_CONTEXT','AUTH_SCHEMA','PRIVATE_INVENTORY','COMPOSITION']);
function text(env,key,min=1,max=8192){const value=env[key];if(typeof value!=='string'||value.length<min||value.length>max||value!==value.trim()||/[\x00-\x1f\x7f]/.test(value))invalid();return value}
function stableKey(env,key){const value=text(env,key);if(!/^[A-Za-z0-9+/]{43}=$/.test(value))invalid();const bytes=Buffer.from(value,'base64');if(bytes.length!==32||bytes.toString('base64')!==value)invalid();return bytes}

/** Server environment only. Never derives keys, resets data, enrolls a customer,
 * creates a schema, authenticates a Core writer, or contacts a provider. */
export function readCustomerServerConfiguration(env=process.env){
 try{
  if(!env||typeof env!=='object'||Array.isArray(env)||env.NODEJS_HELPERS!=='0')invalid();
  const environment=text(env,'CUSTOMER_ENVIRONMENT'),projectRef=projectRefs[environment];if(!projectRef)invalid();
  const customerOrigin=validateCustomerOrigin({environment,customerOrigin:text(env,'CUSTOMER_ORIGIN')});
  const supabaseUrl=text(env,'CUSTOMER_SUPABASE_URL');if(supabaseUrl!=='https://'+projectRef+'.supabase.co')invalid();
  const accountSecret=stableKey(env,'CUSTOMER_ACCOUNT_SECRET_BASE64'),allowanceSecret=stableKey(env,'CUSTOMER_ALLOWANCE_SECRET_BASE64'),budgetSecret=stableKey(env,'CUSTOMER_BUDGET_SECRET_BASE64');
  if(accountSecret.equals(allowanceSecret)||accountSecret.equals(budgetSecret)||allowanceSecret.equals(budgetSecret))invalid();
  if(env.CUSTOMER_REDIRECTS_READY!=='true')invalid();
  const accountMode=env.CUSTOMER_ACCOUNT_MODE??'legacy-preserved';if(!['legacy-preserved','fresh-launch'].includes(accountMode))invalid();
  let receiptDirectory=null,verificationKey=null,usageEpoch=null,launchStartedAt=null;
  if(accountMode==='fresh-launch'){
   usageEpoch=text(env,'CUSTOMER_USAGE_EPOCH',8,64);launchStartedAt=text(env,'CUSTOMER_LAUNCH_STARTED_AT',24,24);
   if(!/^[a-zA-Z0-9_-]{8,64}$/.test(usageEpoch)||!Number.isFinite(Date.parse(launchStartedAt))||new Date(launchStartedAt).toISOString()!==launchStartedAt||Date.parse(launchStartedAt)>Date.now())invalid();
  }else{
  receiptDirectory=env.CUSTOMER_MIGRATION_DIRECTORY===undefined?path.resolve('private-data/migration'):text(env,'CUSTOMER_MIGRATION_DIRECTORY');if(!path.isAbsolute(receiptDirectory)||path.resolve(receiptDirectory)!==receiptDirectory)invalid();
  const encoded=text(env,'CUSTOMER_MIGRATION_PUBLIC_KEY_SPKI_BASE64',1,512),der=Buffer.from(encoded,'base64');
  if(der.toString('base64')!==encoded)invalid();verificationKey=createPublicKey({key:der,type:'spki',format:'der'});
  if(verificationKey.asymmetricKeyType!=='ed25519'||!verificationKey.export({format:'der',type:'spki'}).equals(der))invalid();
  }
  const config={accountMode,usageEpoch,launchStartedAt,environment,customerOrigin,supabaseUrl,serviceRoleKey:text(env,'CUSTOMER_SERVICE_ROLE_KEY',16),tenantKey:text(env,'CUSTOMER_TENANT_KEY',32),accountSecret,allowanceSecret,budgetSecret,deepseekApiKey:text(env,'CUSTOMER_DEEPSEEK_API_KEY',16),redirectReady:true};
  return Object.freeze({config:Object.freeze(config),projectRef,issuer:supabaseUrl+'/functions/v1/core-customer-auth',receiptDirectory,verificationKey,
   connectionString:text(env,'CUSTOMER_AUTH_DATABASE_URL',32),secret:text(env,'CUSTOMER_AUTH_SECRET',32),proxySecret:text(env,'CUSTOMER_AUTH_PROXY_SECRET',32),
   google:Object.freeze({clientId:text(env,'CUSTOMER_GOOGLE_CLIENT_ID'),clientSecret:text(env,'CUSTOMER_GOOGLE_CLIENT_SECRET')}),
   kakao:undefined});
 }catch{invalid()}
}

/** Vercel documents x-vercel-forwarded-for as its platform client-IP header.
 * This resolver is for the Vercel deployment only; no browser guest claim is read.
 * Actual Vercel overwriting/forwarding must pass cloud QA before promotion. */
export function createVercelLoginContext(env=process.env){
 if(env?.VERCEL!=='1')throw new Error('CUSTOMER_PLATFORM_REQUIRED');
 return async request=>{const peer=request?.headers?.get('x-vercel-forwarded-for');
  if(typeof peer!=='string'||!isIP(peer))throw new Error('CUSTOMER_LOGIN_CONTEXT_REQUIRED');
  return {peer,guestEmail:null};
 };
}

export async function createCustomerServerFromEnvironment({env=process.env,fetchImpl=globalThis.fetch,clock=Date.now,sendVerificationOTP}={}){
 const settings=readCustomerServerConfiguration(env),resolveLoginContext=createVercelLoginContext(env);
 const [{createConfiguredCoreAuthPool},{createGoogleOnlyCustomerAuthService},{createReadOnlyMigrationReceiptStore},{createCustomerPublicCompositionV2},{verifySignedLegacyInventory}]=await Promise.all([
  import('./inherited/server/auth/database.mjs'),import('./google-only-auth.mjs'),import('./inherited/customer-migration-receipts.mjs'),import('./customer-public-composition-v2.mjs'),import('./migration-inventory.mjs')]);
 const database=createConfiguredCoreAuthPool({connectionString:settings.connectionString,environment:settings.config.environment,projectRef:settings.projectRef,poolerHost:'aws-0-ap-northeast-2.pooler.supabase.com'});
 attachCustomerVercelPool(database);
 let diagnosticStage='AUTH_CONTEXT';
 try{
  const common={environment:settings.config.environment,customerOrigin:settings.config.customerOrigin,issuer:settings.issuer,secret:settings.secret,proxySecret:settings.proxySecret,database,google:settings.google,kakao:settings.kakao};
  const emailDelivery=sendVerificationOTP??createCustomerEmailDelivery({env,fetchImpl});
  const authService=await createGoogleOnlyCustomerAuthService({...common,mode:'https',sendVerificationOTP:emailDelivery}),providerService=await createGoogleOnlyCustomerAuthService({...common,mode:'callback'});
  // Pinned BetterAuth starts catalog introspection asynchronously. Await its
  // actual schema checks; do not publish a handler while validation is pending.
  const contexts=await Promise.all([authService.auth.$context,providerService.auth.$context]);
  diagnosticStage='AUTH_SCHEMA';
  if(contexts.some(context=>typeof context?.checkSchema!=='function'))throw Error('CUSTOMER_AUTH_SCHEMA_CHECK_REQUIRED');
  await Promise.all(contexts.map(context=>context.checkSchema()));
  if(settings.config.accountMode==='fresh-launch'){
   diagnosticStage='COMPOSITION';
   const composition=createCustomerPublicCompositionV2({config:settings.config,authService,providerService,database,resolveLoginContext,fetchImpl,clock});
   return Object.freeze({...composition,close:()=>database.end()});
  }
  diagnosticStage='PRIVATE_INVENTORY';
  const inventoryFile=path.join(settings.receiptDirectory,'inventory.json'),directoryStat=await lstat(settings.receiptDirectory),before=await lstat(inventoryFile);
  if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory()||await realpath(settings.receiptDirectory)!==settings.receiptDirectory||before.isSymbolicLink()||!before.isFile()||before.size>1024*1024)throw Error('CUSTOMER_INVENTORY_REQUIRED');
  const handle=await open(inventoryFile,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let envelope;
  try{const stat=await handle.stat();if(stat.dev!==before.dev||stat.ino!==before.ino||stat.size>1024*1024)throw Error();const bytes=await handle.readFile();if(bytes.length>1024*1024)throw Error();envelope=JSON.parse(bytes.toString('utf8'))}finally{await handle.close()}
  const inventory=verifySignedLegacyInventory({envelope,verificationKey:settings.verificationKey,stableKeys:settings.config});
  const readTrustedReceipt=createReadOnlyMigrationReceiptStore({directory:settings.receiptDirectory,verificationKey:settings.verificationKey});
  diagnosticStage='COMPOSITION';
  const composition=createCustomerPublicCompositionV2({config:settings.config,authService,providerService,database,inventory,readTrustedReceipt,resolveLoginContext,fetchImpl,clock});
  return Object.freeze({...composition,close:()=>database.end()});
 }catch{await database.end();throw Object.assign(new Error('CUSTOMER_SERVER_CONFIGURATION_INVALID'),{diagnosticStage})}
}

export function createLazyCustomerNodeHandler({createServer=()=>createCustomerServerFromEnvironment()}={}){
 let starting;
 return async(req,res)=>{
  try{starting??=Promise.resolve().then(createServer);const server=await starting;
   if(typeof server?.nodeHandler!=='function')throw Error();await server.nodeHandler(req,res);
  }catch(error){const stage=diagnosticStages.has(error?.diagnosticStage)?error.diagnosticStage:error?.code==='CUSTOMER_SERVER_CONFIGURATION_INVALID'?'SETTINGS':'UNCLASSIFIED';console.error(JSON.stringify({code:'CUSTOMER_SERVER_INIT_FAILED',stage}));if(res.writableEnded||res.destroyed)return;if(res.headersSent){res.destroy?.();return;}res.statusCode=503;res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');res.setHeader('x-content-type-options','nosniff');res.end('{"code":"CUSTOMER_SERVER_UNAVAILABLE"}');}
 };
}
