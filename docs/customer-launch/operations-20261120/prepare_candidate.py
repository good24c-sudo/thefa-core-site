import base64,hashlib,json,pathlib,shutil,subprocess,zipfile,datetime
root=pathlib.Path(r'D:\THE_FA_DEV\isolated\P02_CORE_CUSTOMER_OPERATIONS_20261120')
baseline=pathlib.Path(r'D:\THE_FA_DEV\isolated\P02_CORE_GOOGLE_LOGIN_20261120_CANDIDATE\site')
cli=r'D:\THE_FA_DEV\tools\agent_cli\node_modules\.bin\vercel.cmd'
def unpack(name):
 dest=root/(name+'-unpacked');assert not dest.exists(),'UNPACK_ALREADY_EXISTS'
 raw=base64.b64decode((root/(name+'.b64')).read_text(encoding='utf-8-sig'))
 archive=root/(name+'.zip');archive.write_bytes(raw)
 with zipfile.ZipFile(archive) as z:
  for item in z.namelist():assert '..' not in item and not item.startswith(('/','\\')) and ':' not in item
  z.extractall(dest)
 return dest
def candidate(kind,delta,base,project):
 dest=root/kind;assert not dest.exists(),'CANDIDATE_ALREADY_EXISTS';dest.mkdir()
 m=json.loads((delta/'operations-release-manifest.json').read_text())
 for f in m['files']:
  rel=f['path'];assert '..' not in rel and not rel.startswith(('/','\\')) and ':' not in rel and '.env' not in rel
  p=delta/rel
  if not p.exists():p=base/rel
  b=p.read_bytes();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'],'SOURCE_HASH_MISMATCH:'+rel
  target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
 (dest/'.vercel').mkdir();(dest/'.vercel/project.json').write_text(json.dumps({'projectId':project,'orgId':'team_ukptkCxVKSjdlRwBtymwPtSd'}))
 for f in m['files']:
  if f['path'].endswith(('.mjs','.js')):
   result=subprocess.run(['node','--check',str(dest/f['path'])],capture_output=True)
   assert result.returncode==0,'SYNTAX_FAIL:'+f['path']
 return {'kind':kind,'path':str(dest),'files':len(m['files']),'sourceDigest':m['sourceDigest'],'sha256Verified':True,'syntaxPass':True,'deployed':False}
customer=candidate('customer',unpack('customer-delta'),baseline,'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo')
console_base=root/'console-base';assert not console_base.exists();console_base.mkdir()
for f in json.loads((root/'console-original-manifest.json').read_text(encoding='utf-8-sig')):
 rel=f['path'].removeprefix('src/')
 if '/tests/' in rel:continue
 assert len(f['uid'])==40 and all(c in '0123456789abcdef' for c in f['uid'])
 result=subprocess.run([cli,'api','/v8/deployments/dpl_A8DHqgNnTEfjFq1fS1YTvEfKd1ZW/files/'+f['uid'],'--scope','thefa','--raw'],capture_output=True)
 assert result.returncode==0,'DEPLOYED_SOURCE_READ_FAILED:'+rel
 value=json.loads(result.stdout.decode('utf-8-sig'));b=base64.b64decode(value['data']);assert hashlib.sha1(b).hexdigest()==f['uid'],'DEPLOYED_SOURCE_HASH_MISMATCH:'+rel
 p=console_base/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
console=candidate('console',unpack('console-delta'),console_base,'prj_D76yqyl7E0YXtpEfmQjW0WYA6gjA')
receipt={'contract':'P02_CUSTOMER_OPERATIONS_PREPARATION_V1','customer':customer,'console':console,'secretsRead':False,'productionChanged':False,'oldSourcePreserved':True,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(root/'PREPARATION_RECEIPT.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
