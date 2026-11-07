import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const TARGET = Object.freeze({host:'DESKTOP-0MRB113', project:'cgrppxfdurpzzfvkmfte',
  vercel:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo', team:'team_ukptkCxVKSjdlRwBtymwPtSd',
  vault:'D:/THE_FA/SECRETS/customer-auth-stage2', role:'core_customer_auth_runtime'});
const fail = code => { throw Object.assign(new Error(code), {code}); };

// Private transport: stdout is returned in memory, stderr is never propagated.
// No shell, secret argv, token extraction, automatic retry or CLI login.
export function runPrivate(file, args, input='', timeout=30000) {
  return new Promise((resolve,reject) => {
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!['psmodulepath','psexecutionpolicypreference'].includes(k.toLowerCase())));
    env.PSModulePath=path.win32.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules');
    const child=spawn(file,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
    let output='',diagnostic='',size=0,failed=false;
    const abort=()=>{failed=true;child.kill();};
    const timer=setTimeout(abort,timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',b=>{size+=Buffer.byteLength(b);if(size>2*1024*1024)abort();else output+=b;});
    child.stderr.on('data',b=>{if(diagnostic.length<1024)diagnostic+=b.toString().slice(0,1024-diagnostic.length);});
    child.stdin.on('error',()=>{failed=true;});
    child.on('error',()=>{clearTimeout(timer);reject(Error('PRIVATE_PROVIDER_TRANSPORT_FAILED'));});
    child.on('close',code=>{clearTimeout(timer);if(failed||code!==0){
      const safe=/^CUSTOMER_CREDENTIAL_VAULT_FAILED:[A-Z_]+:[A-Za-z0-9]+:L[0-9]+$/.test(diagnostic.trim());
      reject(Error(safe?diagnostic.trim():'PRIVATE_PROVIDER_TRANSPORT_FAILED'));
    }else resolve(output);});
    child.stdin.end(input);
  });
}

export async function vaultOperation(directory,name,operation,value) {
  const helper=fileURLToPath(new URL('./credential-vault.ps1',import.meta.url));
  return runPrivate('powershell.exe',['-NoProfile','-NonInteractive','-File',helper],
    JSON.stringify({directory,name,operation,value}));
}

// Windows named pipe was verified with the installed Supabase CLI and SELECT 1.
// The pipe carries SQL, never a SQL file on disk. Errors require reconciliation.
export async function queryThroughExistingCli(sql) {
  const pipe='\\\\.\\pipe\\thefa-customer-'+randomUUID();
  const sockets=new Set();let delivered=false;
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    if(delivered){socket.destroy();return;}delivered=true;socket.end(sql);
  });
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});
    const raw=await runPrivate('supabase.exe',['db','query','--linked','--project-ref',TARGET.project,'--file',pipe,'--output','json'],'',60000);
    if(!delivered)fail('SQL_PIPE_NOT_CONSUMED');
    try{return JSON.parse(raw);}catch{fail('PROVIDER_QUERY_RESULT_UNREADABLE');}
  } finally {for(const socket of sockets)socket.destroy();server.close();}
}

export function create4060IO() {
  if(process.platform!=='win32'||process.env.COMPUTERNAME!==TARGET.host)fail('EXACT_4060_HOST_REQUIRED');
  const vercelEntry=path.join(process.env.APPDATA,'npm','node_modules','vercel','dist','vc.js');
  return Object.freeze({
    vault:async(name,operation,value)=>vaultOperation(TARGET.vault,name,operation,value),
    query:queryThroughExistingCli,
    vercel:async(endpoint,method='GET',body)=>{
      if(!endpoint.startsWith('/v10/projects/'+TARGET.vercel+'/env?')&&
         !endpoint.startsWith('/v9/projects/'+TARGET.vercel+'/env?')&&
         endpoint!=='/v9/projects/'+TARGET.vercel+'?teamId='+TARGET.team)fail('EXACT_VERCEL_TARGET_REQUIRED');
      if(!endpoint.includes('teamId='+TARGET.team)||!['GET','POST'].includes(method))fail('EXACT_VERCEL_SCOPE_REQUIRED');
      const args=[vercelEntry,'api',endpoint,'--method',method,'--raw','--non-interactive'];
      if(body!==undefined)args.push('--input','-');
      const raw=await runPrivate(process.execPath,args,body===undefined?'':JSON.stringify(body),60000);
      try{return JSON.parse(raw);}catch{fail('VERCEL_RESULT_UNREADABLE');}
    }
  });
}
