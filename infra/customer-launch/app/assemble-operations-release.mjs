import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function assembleOperationsRelease(destination){
 if(!path.isAbsolute(destination)||path.dirname(destination)!==root||!/^deployment-operations-[a-z0-9-]+$/.test(path.basename(destination)))throw Error('RELEASE_DESTINATION_INVALID');
 try{await lstat(destination);throw Error('RELEASE_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const manifest=JSON.parse(await readFile(path.join(root,'operations-release-manifest.json'),'utf8'));
 if(manifest.contract!=='THEFA_CUSTOMER_OPERATIONS_SOURCE_V1'||!Array.isArray(manifest.files)||manifest.files.length<127)throw Error('RELEASE_MANIFEST_INVALID');
 const files=[],seen=new Set();
 for(const entry of manifest.files){
  const rel=entry.path;if(typeof rel!=='string'||rel.includes('..')||rel.includes('\\')||rel.startsWith('/')||seen.has(rel)||!(/^(api|server|customer-public)\/[a-zA-Z0-9_.\/-]+$/.test(rel)||['package.json','package-lock.json','vercel.json','.vercelignore'].includes(rel)))throw Error('RELEASE_PATH_INVALID');
  if(/(^|\/)\.env|node_modules|\.pem$|\.key$/.test(rel))throw Error('RELEASE_PRIVATE_FILE_REJECTED');
  seen.add(rel);let at=root;for(const part of rel.split('/')){at=path.join(at,part);if((await lstat(at)).isSymbolicLink())throw Error('RELEASE_SYMLINK_REJECTED');}
  const bytes=await readFile(at);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256||bytes.length!==entry.bytes)throw Error('RELEASE_HASH_MISMATCH');files.push({path:rel,bytes});
 }
 await mkdir(destination);for(const f of files){const p=path.join(destination,f.path);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,f.bytes,{flag:'wx'});}
 return {contract:manifest.contract,files:files.length,sourceDigest:manifest.sourceDigest,sourceOnly:true,privateDataCopied:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await assembleOperationsRelease(process.argv[2])));
