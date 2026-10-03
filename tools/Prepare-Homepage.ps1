param([string]$Destination=(Join-Path $env:USERPROFILE 'Desktop/THEFA_Core_Homepage_Cloud_Deploy'))
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
if(Test-Path -LiteralPath $Destination){
  $marker=Join-Path $Destination 'deployment-source.json'
  if(!(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).source -ne $sourceRoot){throw 'DESTINATION_OWNERSHIP_REQUIRED'}
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$publicFiles=@('index.html','demo.html','console.html','contact.html','login.html','signup.html','robots.txt','sitemap.xml')
foreach($relative in $publicFiles){Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination (Join-Path $Destination $relative)}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets') -Destination $Destination -Recurse -Force
$config=[ordered]@{framework=$null;buildCommand='';installCommand='';outputDirectory='.';cleanUrls=$false;trailingSlash=$false}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Destination 'vercel.json') -Encoding utf8
@('deployment-source.json','.env*','api/','cloud/','lab/','supabase/','tools/','docs/') | Set-Content -LiteralPath (Join-Path $Destination '.vercelignore') -Encoding utf8
[ordered]@{source=$sourceRoot;created=[DateTime]::UtcNow.ToString('o');files=$publicFiles;assets_included=$true;runtime_data_included=$false;secrets_included=$false;private_source_included=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Destination 'deployment-source.json') -Encoding utf8
Write-Output "Homepage bundle ready: $Destination (public pages/assets only)"
