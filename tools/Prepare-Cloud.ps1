param([string]$Destination=(Join-Path $env:USERPROFILE 'Desktop/THEFA_Core_Console_Cloud_Deploy'))
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
if(Test-Path -LiteralPath $Destination){
  $marker=Join-Path $Destination 'deployment-source.json'
  if(!(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).source -ne $sourceRoot){throw 'DESTINATION_OWNERSHIP_REQUIRED'}
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$ownedFiles=@('api/console.mjs','cloud/auth.mjs','cloud/server.mjs','cloud/store.mjs','cloud/engine-adapter.mjs','cloud/login.html','cloud/login.css','cloud/login.js','lab/server.mjs','lab/public/app.js','lab/public/index.html','lab/public/styles.css','lab/public/assets/THEFA_Core_Wordmark_Dark_web.svg','lab/public/assets/PretendardVariable-subset.woff2')
foreach($relative in $ownedFiles){
  $target=Join-Path $Destination $relative
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $target
}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'cloud/vercel.json') -Destination (Join-Path $Destination 'vercel.json')
New-Item -ItemType Directory -Path (Join-Path $Destination 'public') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $Destination 'public/.gitkeep') -Value '' -NoNewline
$utf8=New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $Destination 'package.json'),'{"private":true,"type":"module","engines":{"node":"24.x"}}',$utf8)
[IO.File]::WriteAllText((Join-Path $Destination '.vercelignore'),'deployment-source.json',$utf8)
$manifest=[ordered]@{source=$sourceRoot;created=(Get-Date).ToUniversalTime().ToString('o');files=$ownedFiles;runtime_data_included=$false;secrets_included=$false}
[IO.File]::WriteAllText((Join-Path $Destination 'deployment-source.json'),($manifest | ConvertTo-Json -Depth 5),$utf8)
Write-Output "Cloud bundle ready: $Destination ($($ownedFiles.Count) files; no runtime data or secrets)"
