import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
let api={};try{api=await import('../assemble-release.mjs')}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error}
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('release assembly exposes exactly26 browser files and privately packages actual bootstrap runtime',async()=>{
 assert.equal(typeof api.assembleCustomerRelease,'function');
 const outputDirectory=path.join(root,'deployment-candidate-test-'+randomUUID());
 const manifest=await api.assembleCustomerRelease({outputDirectory});
 assert.equal(manifest.publicFiles.length,26);assert.equal(manifest.runtimeFiles.length>=27,true);
 assert.equal(manifest.validationFiles.some(x=>x.path==='tests/bootstrap.test.mjs'),true);
  assert.equal(manifest.validationFiles.some(x=>x.path==='tests/r42_google_only_ui.test.mjs'),true);assert.equal(manifest.validationFiles.some(x=>x.path==='tests/fake-lease-database.mjs'),true);assert.equal(manifest.validationFiles.some(x=>x.path==='public-files.json'),true);
 const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.relative(path.join(outputDirectory,'customer-public'),path.join(dir,x.name)).replaceAll('\\','/')]))).flat();
 const files=await walk(path.join(outputDirectory,'customer-public'));
 assert.equal(files.length,26);assert.equal(files.some(x=>/server|api\/|\.mjs$|\.env|private-data|\.json$/.test(x)),false);
 const config=JSON.parse(await readFile(path.join(outputDirectory,'vercel.json'),'utf8'));
 assert.equal(config.outputDirectory,'customer-public');assert.equal(config.public,false);
 assert.equal(config.rewrites.find(x=>x.source==='/about').destination,'/about.html');
 for(const source of ["/api/auth/providers", "/api/auth/session", "/auth/start", "/auth/logout", "/auth/complete", "/auth/email/send", "/auth/email/verify", "/api/customer/workspace", "/api/customer/action", "/api/customer/chat/send", "/api/customer/billing", "/api/customer/allowance", "/functions/v1/core-customer-auth/callback/google/oauth-proxy", "/functions/v1/core-customer-auth/callback/kakao/oauth-proxy"])assert.equal(config.rewrites.find(x=>x.source===source).destination,'/api/dispatch?__customer_route='+source);
 assert.equal(config.rewrites.filter(x=>x.destination.startsWith('/api/dispatch')).some(x=>x.source.includes(':')),false);
 assert.equal(config.rewrites.find(x=>x.source==='/server/:path*').destination,'/api/source-denied');
 assert.equal(config.functions['api/dispatch.mjs'].includeFiles,'private-data/migration/**');
 const gitIgnore=await readFile(path.join(outputDirectory,'.gitignore'),'utf8'),vercelIgnore=await readFile(path.join(outputDirectory,'.vercelignore'),'utf8');assert.match(gitIgnore,/private-data\//);assert.match(vercelIgnore,/!private-data/);assert.match(vercelIgnore,/\*\*\/\*\.bin/);
 await assert.rejects(()=>api.assembleCustomerRelease({outputDirectory}),/CUSTOMER_RELEASE_OUTPUT_EXISTS/);
 await assert.rejects(()=>api.assembleCustomerRelease({outputDirectory:path.join(root,'../outside')}),/CUSTOMER_RELEASE_OUTPUT_INVALID/);
});
