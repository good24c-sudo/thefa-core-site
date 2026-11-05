import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
let api={};try{api=await import('../assemble-release.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('release assembly exposes exactly34 reviewed browser files and privately packages actual bootstrap runtime',async()=>{
 assert.equal(typeof api.assembleCustomerRelease,'function');
 const outputDirectory=path.join(root,'deployment-candidate-test-'+randomUUID());
 const manifest=await api.assembleCustomerRelease({outputDirectory});
 assert.equal(manifest.publicFiles.length,34);assert.equal(manifest.runtimeFiles.length>=27,true);
 assert.equal(manifest.validationFiles.some(x=>x.path==='tests/bootstrap.test.mjs'),true);
  assert.equal(manifest.validationFiles.some(x=>x.path==='tests/r42_google_only_ui.test.mjs'),true);assert.equal(manifest.validationFiles.some(x=>x.path==='tests/fake-lease-database.mjs'),true);assert.equal(manifest.validationFiles.some(x=>x.path==='public-files.json'),true);
 const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.relative(path.join(outputDirectory,'customer-public'),path.join(dir,x.name)).replaceAll('\\','/')]))).flat();
 const files=await walk(path.join(outputDirectory,'customer-public'));
 assert.equal(files.length,34);assert.equal(files.some(x=>/server|api\/|\.mjs$|\.env|private-data|\.json$/.test(x)),false);

 const newStudioFiles=['studio.html','studio.css','studio.js','studio-entry.css',
   'vendor/pptxgen.min.js','vendor/jszip.min.js',
   'vendor/PPTXGENJS-LICENSE.txt','vendor/JSZIP-LICENSE.txt'];
 for(const name of newStudioFiles){
   assert.equal(files.includes(name),true,'MISSING_REVIEWED_STUDIO_ASSET: '+name);
   const published=await readFile(path.join(outputDirectory,'customer-public',name));
   const source=await readFile(path.join(root,'public-source',name));
   assert.deepEqual(published,source,'BYTE_DRIFT_STUDIO_ASSET: '+name);
 }
 assert.equal(newStudioFiles.length,8);
 for(const name of ['index.html','guest-live.js','guest-live.css'])
   assert.equal(files.includes(name),true);
 const studioHtml=await readFile(path.join(outputDirectory,'customer-public','studio.html'),'utf8');
 assert.equal(studioHtml.includes('/vendor/pptxgen.min.js'),true);
 assert.equal(studioHtml.includes('/vendor/jszip.min.js'),true);
 const workbench=await readFile(path.join(outputDirectory,'customer-public','index.html'),'utf8');
 assert.equal(workbench.includes('href="/studio.html"'),true);
 assert.equal(workbench.includes('id="chat-form"'),true);
 const scopedJavaScript=await readFile(path.join(outputDirectory,'customer-public','guest-live.js'),'utf8');
 assert.equal(scopedJavaScript.includes('keepReadingPosition'),true);
 assert.equal(scopedJavaScript.includes('renderSidebar'),true);
 const publicAssetNames=manifest.publicFiles.map(x=>x.path.replace(/^customer-public\//,''));
 assert.equal(new Set(publicAssetNames).size,34);

 const config=JSON.parse(await readFile(path.join(outputDirectory,'vercel.json'),'utf8'));
 assert.equal(config.outputDirectory,'customer-public');assert.equal(config.public,false);
 assert.equal(config.rewrites.find(x=>x.source==='/about').destination,'/about.html');
 for(const source of ["/api/auth/providers", "/api/auth/session", "/auth/start", "/auth/logout", "/auth/complete", "/auth/email/send", "/auth/email/verify", "/api/customer/workspace", "/api/customer/action", "/api/customer/chat/send", "/api/customer/billing", "/api/customer/allowance", "/functions/v1/core-customer-auth/callback/google/oauth-proxy", "/functions/v1/core-customer-auth/callback/kakao/oauth-proxy"])assert.equal(config.rewrites.find(x=>x.source===source).destination,'/api/dispatch?__customer_route='+source);
 const dynamic=config.rewrites.filter(x=>x.destination.startsWith('/api/dispatch')&&x.source.includes(':'));
 assert.deepEqual(dynamic,[{source:'/api/customer/conversations/:conversationId(chat_[0-9a-f-]{36})',destination:'/api/dispatch?__customer_route=/api/customer/conversations/:conversationId'}]);
 assert.equal(config.rewrites.find(x=>x.source==='/server/:path*').destination,'/api/source-denied');
 assert.equal(config.functions['api/dispatch.mjs'].includeFiles,'private-data/migration/**');
 const gitIgnore=await readFile(path.join(outputDirectory,'.gitignore'),'utf8'),vercelIgnore=await readFile(path.join(outputDirectory,'.vercelignore'),'utf8');assert.match(gitIgnore,/private-data\//);assert.match(vercelIgnore,/!private-data/);assert.match(vercelIgnore,/\*\*\/\*\.bin/);
 await assert.rejects(()=>api.assembleCustomerRelease({outputDirectory}),/CUSTOMER_RELEASE_OUTPUT_EXISTS/);
 await assert.rejects(()=>api.assembleCustomerRelease({outputDirectory:path.join(root,'../outside')}),/CUSTOMER_RELEASE_OUTPUT_INVALID/);
});
