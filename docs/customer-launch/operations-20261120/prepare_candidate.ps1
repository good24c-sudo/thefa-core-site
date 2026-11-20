$ErrorActionPreference='Stop'
$root='D:\THE_FA_DEV\isolated\P02_CORE_CUSTOMER_OPERATIONS_20261120'
$baseline='D:\THE_FA_DEV\isolated\P02_CORE_GOOGLE_LOGIN_20261120_CANDIDATE\site'
$cli='D:\THE_FA_DEV\tools\agent_cli\node_modules\.bin\vercel.cmd'
$utf8=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Decode-Zip($name){
 $zip=Join-Path $root ($name+'.zip');$delta=Join-Path $root ($name+'-unpacked')
 if(Test-Path -LiteralPath $delta){throw 'UNPACK_ALREADY_EXISTS'}
 [IO.File]::WriteAllBytes($zip,[Convert]::FromBase64String([IO.File]::ReadAllText((Join-Path $root ($name+'.b64')))))
 [IO.Compression.ZipFile]::ExtractToDirectory($zip,$delta)
 return $delta
}
function Build-Candidate($kind,$delta,$base,$project){
 $dest=Join-Path $root $kind
 if(Test-Path -LiteralPath $dest){throw 'CANDIDATE_ALREADY_EXISTS'}
 [IO.Directory]::CreateDirectory($dest)|Out-Null
 $manifest=Get-Content -LiteralPath (Join-Path $delta 'operations-release-manifest.json') -Raw|ConvertFrom-Json
 foreach($file in $manifest.files){
  if($file.path -match '(^/|\.\.|\\|\.env|\.pem$|\.key$|node_modules)'){throw 'UNSAFE_MANIFEST_PATH'}
  $from=Join-Path $delta $file.path;if(!(Test-Path -LiteralPath $from)){$from=Join-Path $base $file.path}
  $bytes=[IO.File]::ReadAllBytes($from);$hash=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  if($hash -ne $file.sha256 -or $bytes.Length -ne $file.bytes){throw ('SOURCE_HASH_MISMATCH '+$file.path)}
  $to=Join-Path $dest $file.path;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($to))|Out-Null;[IO.File]::WriteAllBytes($to,$bytes)
 }
 [IO.Directory]::CreateDirectory((Join-Path $dest '.vercel'))|Out-Null
 $link=@{projectId=$project;orgId='team_ukptkCxVKSjdlRwBtymwPtSd'}|ConvertTo-Json -Compress
 [IO.File]::WriteAllText((Join-Path $dest '.vercel\project.json'),$link,$utf8)
 foreach($file in $manifest.files){if($file.path.EndsWith('.mjs') -or $file.path.EndsWith('.js')){& node --check (Join-Path $dest $file.path);if($LASTEXITCODE -ne 0){throw ('SYNTAX_FAIL '+$file.path)}}}
 return @{kind=$kind;path=$dest;files=$manifest.files.Count;sourceDigest=$manifest.sourceDigest;sha256Verified=$true;syntaxPass=$true;deployed=$false}
}
$customerDelta=Decode-Zip 'customer-delta'
$customer=Build-Candidate 'customer' $customerDelta $baseline 'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo'
$consoleBase=Join-Path $root 'console-base'
if(Test-Path -LiteralPath $consoleBase){throw 'CONSOLE_BASE_ALREADY_EXISTS'}
[IO.Directory]::CreateDirectory($consoleBase)|Out-Null
$files=Get-Content -LiteralPath (Join-Path $root 'console-original-manifest.json') -Raw|ConvertFrom-Json
foreach($file in $files){
 $path=$file.path.Substring(4)
 if($path -match '/tests/'){continue}
 $raw=& $cli api ('/v8/deployments/dpl_A8DHqgNnTEfjFq1fS1YTvEfKd1ZW/files/'+$file.uid) --scope thefa --raw 2>$null
 if($LASTEXITCODE -ne 0){throw ('DEPLOYED_SOURCE_READ_FAILED '+$path)}
 $value=($raw -join [Environment]::NewLine)|ConvertFrom-Json;$bytes=[Convert]::FromBase64String($value.data)
 $sha=([BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
 if($sha -ne $file.uid){throw ('DEPLOYED_SOURCE_HASH_MISMATCH '+$path)}
 $to=Join-Path $consoleBase $path;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($to))|Out-Null;[IO.File]::WriteAllBytes($to,$bytes)
}
$consoleDelta=Decode-Zip 'console-delta'
$console=Build-Candidate 'console' $consoleDelta $consoleBase 'prj_D76yqyl7E0YXtpEfmQjW0WYA6gjA'
$receipt=@{contract='P02_CUSTOMER_OPERATIONS_PREPARATION_V1';customer=$customer;console=$console;secretsRead=$false;productionChanged=$false;oldSourcePreserved=$true;observedAt=[DateTime]::UtcNow.ToString('o')}
$json=$receipt|ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $root 'PREPARATION_RECEIPT.json'),$json,$utf8)
$json
