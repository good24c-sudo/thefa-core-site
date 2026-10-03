param([switch]$PlanOnly,[switch]$LocalAI,[switch]$DevelopmentTools,[switch]$Consent,[string]$TargetRoot=(Join-Path $env:LOCALAPPDATA 'THEFA\LocalWorkspace'))
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
function Write-Result($value){[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'setup-result.json'),($value|ConvertTo-Json -Depth 8),$utf8)}
function Refresh-Path {$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')}
function Ensure-Program($command,$package){
 if(Get-Command $command -ErrorAction SilentlyContinue){return}
 if(!(Get-Command winget -ErrorAction SilentlyContinue)){throw 'Windows App Installer (winget) is required. Open Microsoft Store and update App Installer.'}
 & winget install --id $package --exact --source winget --silent --accept-source-agreements --accept-package-agreements
 if($LASTEXITCODE -ne 0){throw "Package installation failed: $package (exit $LASTEXITCODE)"}
 Refresh-Path
 if(!(Get-Command $command -ErrorAction SilentlyContinue)){throw "Restart Windows and run setup again: $package"}
}
try {
 $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'payload-manifest.json') -Raw|ConvertFrom-Json
 if($manifest.payload_hash -notmatch '^[a-f0-9]{64}$'){throw 'Invalid package version identifier'}
 $payloadRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'payload'))+[IO.Path]::DirectorySeparatorChar
 foreach($entry in $manifest.files){
  $file=[IO.Path]::GetFullPath((Join-Path $payloadRoot $entry.path))
  if(!$file.StartsWith($payloadRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Payload path outside package'}
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw 'Package integrity check failed. Download the original package again.'}
 }
 $packages=@(@{command='node';id='OpenJS.NodeJS.LTS'})
 if($DevelopmentTools){$packages+=@{command='git';id='Git.Git'};$packages+=@{command='code';id='Microsoft.VisualStudioCode'}}
 if($LocalAI){$packages+=@{command='ollama';id='Ollama.Ollama'}}
 if($PlanOnly){Write-Result @{status='PLAN_ONLY';packages=$packages;local_model=$(if($LocalAI){'qwen2.5:3b'}else{$null});target=$TargetRoot;payload_verified=$true;source_head=$manifest.source_head;network_calls=0;installation_performed=$false};exit 0}
 if(!$Consent){throw 'Installer consent is required before package installation and license acceptance.'}
 New-Item -ItemType Directory -Path $TargetRoot -Force|Out-Null
 $marker=Join-Path $TargetRoot 'thefa-owner.json'
 if((Get-ChildItem -LiteralPath $TargetRoot -Force|Measure-Object).Count -gt 0 -and !(Test-Path -LiteralPath $marker)){throw 'Target contains unrelated files. Setup stopped without overwriting them.'}
 foreach($package in $packages){Ensure-Program $package.command $package.id}
 $node=(Get-Command node).Source;$major=[int]((& $node --version).TrimStart('v').Split('.')[0])
 if($major -lt 22){throw 'Node.js 22 or later is required. The existing Node installation was preserved.'}
 if($LocalAI){
  $ollama=(Get-Command ollama).Source
  try{Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3|Out-Null}catch{Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden;Start-Sleep -Seconds 3}
  $models=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
  if(!($models.models | Where-Object {$_.name -eq 'qwen2.5:3b'})){
   & $ollama pull 'qwen2.5:3b'
   if($LASTEXITCODE -ne 0){throw 'Local model download failed. Retry setup; existing models are preserved.'}
  }
 }
 # Immutable versions protect running work and make interrupted setup safe to repeat.
 $versionRoot=Join-Path $TargetRoot ('versions\'+$manifest.payload_hash)
 New-Item -ItemType Directory -Path $versionRoot -Force|Out-Null
 Copy-Item -LiteralPath (Join-Path $payloadRoot 'lab') -Destination $versionRoot -Recurse -Force
 [IO.File]::WriteAllText($marker,(@{product='THE FA Core local sandbox';data_preserved=$true}|ConvertTo-Json),$utf8)
 $dataRoot=Join-Path $TargetRoot 'data';New-Item -ItemType Directory -Path $dataRoot -Force|Out-Null
 $port=4176
 try{$existing=Invoke-RestMethod "http://127.0.0.1:$port/api/state" -TimeoutSec 2}catch{$existing=$null}
 if($existing){throw 'Port 4176 is already in use. The existing server was preserved; close only your previous THE FA local app and retry.'}
 $entry=Join-Path $versionRoot 'lab\desktop.mjs'
 $env:THEFA_LOCAL_DATA=$dataRoot
 $process=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataRoot 'runtime.log') -RedirectStandardError (Join-Path $dataRoot 'runtime-error.log')
 $ready=$false
 for($attempt=0;$attempt -lt 20;$attempt++){try{$state=Invoke-RestMethod "http://127.0.0.1:$port/api/state" -TimeoutSec 2;$ready=$true;break}catch{Start-Sleep -Milliseconds 500}}
 if(!$ready){throw 'Local app did not become ready. Check runtime-error.log; setup is not complete.'}
 $launch=Join-Path $TargetRoot 'Open-THEFA.cmd'
 $command='@echo off'+"`r`n"+'set "THEFA_LOCAL_DATA='+$dataRoot+'"'+"`r`n"+'start "" /b "'+$node+'" "'+$entry+'"'+"`r`n"+'start "" "http://127.0.0.1:4176/#setup"'
 [IO.File]::WriteAllText($launch,$command,[Text.Encoding]::Default)
 $shortcutPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'THE FA Core Local.lnk';if(!(Test-Path -LiteralPath $shortcutPath)){$shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($shortcutPath);$shortcut.TargetPath=$launch;$shortcut.WorkingDirectory=$TargetRoot;$shortcut.WindowStyle=7;$shortcut.Save()}
 Write-Result @{status='LOCAL_READY';url='http://127.0.0.1:4176/#setup';pid=$process.Id;source_head=$manifest.source_head;payload_hash=$manifest.payload_hash;local_ai=$LocalAI;cloud_account_linked=$false;ava_creation_available=$false;runtime_verified=$ready;data_root=$dataRoot}
}catch{Write-Result @{status='FAILED';message=$_.Exception.Message;installation_complete=$false};exit 1}
