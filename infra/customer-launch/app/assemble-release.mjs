import {readFile,lstat,realpath,mkdir,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const problem=code=>Object.assign(new Error(code),{code});
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function checked(relative){
 if(typeof relative!=='string'||relative.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.')&&!['.gitignore','.vercelignore'].includes(relative))||!/^[-A-Za-z0-9_./]+$/.test(relative))throw problem('CUSTOMER_RELEASE_SOURCE_INVALID');
 let p=root;for(const part of relative.split('/')){p=path.join(p,part);const stat=await lstat(p);if(stat.isSymbolicLink()||!same(await realpath(p),p))throw problem('CUSTOMER_RELEASE_SOURCE_INVALID');}
 if(!(await lstat(p)).isFile())throw problem('CUSTOMER_RELEASE_SOURCE_INVALID');return readFile(p);
}
export async function assembleCustomerRelease({outputDirectory}={}){
 if(typeof outputDirectory!=='string'||!path.isAbsolute(outputDirectory)||!same(path.resolve(outputDirectory),outputDirectory)||!same(path.dirname(outputDirectory),root)||!/^deployment-candidate(?:-[a-z0-9-]+)?$/.test(path.basename(outputDirectory)))throw problem('CUSTOMER_RELEASE_OUTPUT_INVALID');
 try{await lstat(outputDirectory);throw problem('CUSTOMER_RELEASE_OUTPUT_EXISTS')}catch(e){if(e.code!=='ENOENT')throw e}
 const sourceManifest=JSON.parse(await checked('public-files.json'));
 if(sourceManifest.length!==26||new Set(sourceManifest.map(x=>x.path)).size!==26)throw problem('CUSTOMER_RELEASE_PUBLIC_MANIFEST_INVALID');
 const inherited=JSON.parse(await checked('evidence/R42_INHERITED_RUNTIME_MANIFEST.json')),pending=[];
 for(const f of sourceManifest){if(/(?:^|\/)(?:server|api|private-data|node_modules)(?:\/|$)|\.(?:mjs|json|env|pem|key)$/.test(f.path))throw problem('CUSTOMER_RELEASE_PUBLIC_MANIFEST_INVALID');const bytes=await checked('public-source/'+f.path);if(sha(bytes)!==f.sha256)throw problem('CUSTOMER_RELEASE_SOURCE_HASH_MISMATCH');pending.push({path:'customer-public/'+f.path,bytes,kind:'public'});}
 for(const f of inherited.files){const rel='server/inherited/'+f.path,bytes=await checked(rel);if(sha(bytes)!==f.sha256)throw problem('CUSTOMER_RELEASE_SOURCE_HASH_MISMATCH');pending.push({path:rel,bytes,kind:'runtime'});}
 for(const rel of ['server/bootstrap.mjs','server/fresh-launch-accounts.mjs','server/email-delivery.mjs','server/employee-entitlement.mjs','server/google-only-auth.mjs','server/migration-inventory.mjs','server/signup-classifier.mjs','server/customer-account-lifecycle-v2.mjs','server/customer-session-verifier-v2.mjs','server/customer-public-composition-v2.mjs','api/dispatch.mjs','api/source-denied.mjs','vercel.json','package.json','package-lock.json','.gitignore','.vercelignore'])pending.push({path:rel,bytes:await checked(rel),kind:rel.startsWith('server/')?'runtime':'configuration'});
 // Keep the official source package independently testable. The deployment's
 // .vercelignore excludes tests/build inputs from upload; output stays26 files.
 const validation=['assemble-release.mjs','public-files.json','evidence/R42_INHERITED_RUNTIME_MANIFEST.json','callback-edge/index.ts','deno.json','server/migration-package.mjs',...sourceManifest.map(f=>'public-source/'+f.path),...(await readdir(path.join(root,'tests'))).filter(name=>/^[a-z0-9_-]+(?:\.test)?\.mjs$/.test(name)).map(name=>'tests/'+name)];
 for(const rel of validation)pending.push({path:rel,bytes:await checked(rel),kind:'validation'});
 // Full hash/path preflight precedes output creation. The destination never exists.
 await mkdir(outputDirectory);
 for(const file of pending){const dest=path.join(outputDirectory,...file.path.split('/'));await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,file.bytes,{flag:'wx'});}
 const describe=kind=>pending.filter(x=>x.kind===kind).map(x=>({path:x.path,sha256:sha(x.bytes),bytes:x.bytes.length}));
 return {contract:'R39_CUSTOMER_PRIVATE_RUNTIME_RELEASE_ASSEMBLY_V1',status:'ISOLATED_CANDIDATE_NOT_DEPLOYED',outputDirectory,publicFiles:describe('public'),runtimeFiles:describe('runtime'),configurationFiles:describe('configuration'),validationFiles:describe('validation'),privateMigrationSnapshotsProvisioned:false,providerCalls:0,actualCloudQa:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const manifest=await assembleCustomerRelease({outputDirectory:path.join(root,'deployment-candidate')});process.stdout.write(JSON.stringify(manifest,null,2)+'\n');}
