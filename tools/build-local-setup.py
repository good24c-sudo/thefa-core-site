"""Build a source-only local installer package from an explicit public allowlist."""
from pathlib import Path
import hashlib,json,subprocess,zipfile,io
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'lab/public/downloads/THEFA-Local-Setup-Windows.zip'
def build():
 head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 files={'payload/lab/server.mjs':(ROOT/'lab/server.mjs').read_bytes()}
 for f in (ROOT/'lab/public').rglob('*'):
  if f.is_file() and 'downloads' not in f.relative_to(ROOT/'lab/public').parts:
   if f.suffix.lower() not in {'.html','.js','.css','.svg','.woff2'}:raise ValueError('Unexpected public payload file')
   files['payload/'+f.relative_to(ROOT).as_posix()]=f.read_bytes()
 files['payload/lab/desktop.mjs']=b"import {createLabServer} from './server.mjs';\nimport path from 'node:path';\nconst root=process.env.THEFA_LOCAL_DATA;\nif(!root||!path.isAbsolute(root))throw new Error('LOCAL_DATA_REQUIRED');\nconst app=await createLabServer({runtimeDir:path.join(root,'state'),outputDir:path.join(root,'output')});\napp.server.on('error',async error=>{console.error(error.code);await app.close();process.exitCode=1;});\napp.server.listen(4176,'127.0.0.1');\nfor(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});\n"
 records=[{'path':name.removeprefix('payload/'),'sha256':hashlib.sha256(content).hexdigest()} for name,content in sorted(files.items())]
 digest=hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
 files['payload-manifest.json']=json.dumps({'source_head':head,'payload_hash':digest,'files':records},indent=2).encode()
 for name in ['Start.cmd','Install.ps1','Setup-Worker.ps1','README.txt']:
  files[name]=(ROOT/'tools/local-setup'/name).read_bytes()
 OUT.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED) as archive:
  for name,content in sorted(files.items()):
   info=zipfile.ZipInfo(name,date_time=(2026,10,3,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,content)
 receipt={'source_head':head,'payload_hash':digest,'zip_sha256':hashlib.sha256(OUT.read_bytes()).hexdigest(),'files':len(files),'bytes':OUT.stat().st_size,'contains_secrets':False,'installed_on_this_pc':False}
 print(json.dumps(receipt,indent=2))
 return receipt
if __name__=='__main__':build()
