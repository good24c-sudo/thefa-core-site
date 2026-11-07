import path from 'node:path';
import {TARGET,runPrivate} from './credential-io.mjs';
import {PROBE_SOURCE_PATHS,environmentMetadataHash} from './sensitive-proof-contract.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const deploymentId=id=>{if(!/^dpl_[A-Za-z0-9]+$/.test(id??''))fail('EXACT_DEPLOYMENT_ID_REQUIRED');return id;};

export function sourceTreeFiles(tree){
  if(!Array.isArray(tree)||tree.length!==2||tree.some(n=>!['src','out'].includes(n.name))||
     new Set(tree.map(n=>n.name)).size!==2)fail('COMPLETE_VERCEL_SOURCE_TREE_REQUIRED');
  const src=tree.find(n=>n.name==='src'),files=[];
  function walk(nodes,prefix='',depth=0){
    if(!Array.isArray(nodes)||depth>8)fail('COMPLETE_VERCEL_SOURCE_TREE_REQUIRED');
    for(const n of nodes){
      if(!/^[A-Za-z0-9_.-]+$/.test(n.name??'')||['.','..'].includes(n.name))fail('UNEXPECTED_VERCEL_SOURCE_PATH');
      const name=prefix+n.name;
      if(n.type==='directory')walk(n.children,name+'/',depth+1);
      else if(n.type==='file'&&/^[a-f0-9]{40}$/.test(n.uid??''))files.push({path:name,uid:n.uid});
      else fail('UNSUPPORTED_VERCEL_SOURCE_NODE');
    }
  }
  if(src.type!=='directory')fail('COMPLETE_VERCEL_SOURCE_TREE_REQUIRED');walk(src.children);
  if(JSON.stringify(files.map(f=>f.path).sort())!==JSON.stringify(PROBE_SOURCE_PATHS))fail('EXACT_PROBE_SOURCE_FILES_REQUIRED');
  return files;
}

/** Read-only existing-CLI adapter, no token extraction or caller-supplied URL.
 * Normal worker installation/admission remains outside this module.
 */
export function create4060ProofReader(){
  if(process.platform!=='win32'||process.env.COMPUTERNAME!==TARGET.host)fail('EXACT_4060_HOST_REQUIRED');
  const cli=path.join(process.env.APPDATA,'npm/node_modules/vercel/dist/vc.js');
  const get=async(route,extra='')=>{
    const raw=await runPrivate(process.execPath,[cli,'api',route+'?teamId='+TARGET.team+extra,'--method','GET','--raw','--non-interactive'],'',60000);
    try{return JSON.parse(raw);}catch{fail('AUTHENTICATED_VERCEL_JSON_REQUIRED');}
  };
  const getDeployment=async id=>{
    const r=await get('/v13/deployments/'+deploymentId(id));
    if(r.id!==id||r.projectId!==TARGET.vercel||r.ownerId!==TARGET.team)fail('EXACT_VERCEL_DEPLOYMENT_SCOPE_REQUIRED');
    return r;
  };
  return Object.freeze({
    getDeployment,
    async getProject(id){
      if(id!==TARGET.vercel)fail('EXACT_VERCEL_PROJECT_REQUIRED');
      const r=await get('/v9/projects/'+id);
      if(r.id!==id||r.accountId!==TARGET.team)fail('EXACT_VERCEL_PROJECT_REQUIRED');return r;
    },
    async getEnvironmentMetadata(id){
      if(id!==TARGET.vercel)fail('EXACT_VERCEL_PROJECT_REQUIRED');
      const r=await get('/v10/projects/'+id+'/env');
      if(!Array.isArray(r.envs)||r.pagination?.next)fail('COMPLETE_VERCEL_ENV_READBACK_REQUIRED');
      const entries=r.envs.filter(e=>Array.isArray(e.target)&&e.target.includes('production'));
      if(entries.some(e=>e.gitBranch))fail('AMBIGUOUS_VERCEL_PRODUCTION_SCOPE');
      const metadata=entries.map(e=>({id:e.id,key:e.key,type:e.type,target:e.target,updatedAt:e.updatedAt}));
      environmentMetadataHash(metadata);return metadata;
    },
    async getSourceFiles(id){
      await getDeployment(id);
      const files=sourceTreeFiles(await get('/v6/deployments/'+deploymentId(id)+'/files'));
      return Promise.all(files.map(async f=>{
        const r=await get('/v8/deployments/'+id+'/files/'+f.uid);
        if(typeof r.data!=='string'||r.data.length>1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.data))
          fail('COMPLETE_VERCEL_SOURCE_BYTES_REQUIRED');
        return {path:f.path,bytes:Buffer.from(r.data,'base64')};
      }));
    },
    async getBuildEvents(id){
      await getDeployment(id);
      const events=await get('/v3/deployments/'+deploymentId(id)+'/events','&builds=1&limit=-1&follow=0');
      if(!Array.isArray(events))fail('COMPLETE_AUTHENTICATED_BUILD_EVENTS_REQUIRED');return events;
    }
  });
}
