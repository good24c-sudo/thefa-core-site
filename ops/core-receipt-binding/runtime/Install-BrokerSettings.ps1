param([switch]$Apply)
$ErrorActionPreference='Stop'
if ($env:COMPUTERNAME -ne 'DESKTOP-0MRB113') { throw 'APPROVED_4060_HOST_REQUIRED' }
$project='furfjhymxqsbhvuyeqpx'
$root='D:\THE_FA\SECRETS\provider-broker-v1'
$endpoint='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/thefa-customer-broker-authority'
$names=@('THE_FA_ACTION_AUTHORITY_ENDPOINT','THE_FA_ACTION_AUTHORITY_BEARER',
 'THE_FA_SUPABASE_ACTION_PROVIDER_ENDPOINT','THE_FA_SUPABASE_ACTION_READBACK_ENDPOINT',
 'THE_FA_PROVIDER_INTERNAL_BEARER','THE_FA_PROVIDER_RECEIPT_VERIFIER_ENDPOINT',
 'THE_FA_PROVIDER_RECEIPT_VERIFIER_BEARER','THE_FA_ACTION_BROKER_BEARER')
if (!$Apply) { @{decision='REVIEW_ONLY';project=$project;names=$names;host_local_dpapi_root=$root} | ConvertTo-Json -Depth 3; exit }
$existingRaw=& (Get-Command supabase).Source secrets list --project-ref $project --output json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'SETTINGS_NAME_READBACK_FAILED' }
$existing=$existingRaw | ConvertFrom-Json
if (@($existing | Where-Object { $_.name -in $names }).Count -ne 0) {
 throw 'EXISTING_SETTINGS_RECONCILE_ONLY'
}
if (Test-Path -LiteralPath $root) { throw 'EXISTING_PRIVATE_SETUP_RECONCILE_ONLY' }
$null=New-Item -ItemType Directory -Path $root
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($sid in @($currentSid,(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))) {
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $root -AclObject $acl
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PRIVATE_ROOT_REPARSE_REJECTED' }
$values=[ordered]@{
 THE_FA_ACTION_AUTHORITY_ENDPOINT=($endpoint+'/authority')
 THE_FA_SUPABASE_ACTION_PROVIDER_ENDPOINT=($endpoint+'/provider')
 THE_FA_SUPABASE_ACTION_READBACK_ENDPOINT=($endpoint+'/readback')
 THE_FA_PROVIDER_RECEIPT_VERIFIER_ENDPOINT=($endpoint+'/verify')
}
$files=[ordered]@{
 THE_FA_ACTION_AUTHORITY_BEARER='action-authority-bearer.dpapi'
 THE_FA_PROVIDER_INTERNAL_BEARER='provider-internal-bearer.dpapi'
 THE_FA_PROVIDER_RECEIPT_VERIFIER_BEARER='provider-receipt-verifier-bearer.dpapi'
 THE_FA_ACTION_BROKER_BEARER='action-broker-bearer.dpapi'
}
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try {
 foreach($key in $files.Keys) {
  $bytes=New-Object byte[] 32; $rng.GetBytes($bytes)
  $value=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
  $values[$key]=$value
  $secure=ConvertTo-SecureString -String $value -AsPlainText -Force
  $encrypted=ConvertFrom-SecureString -SecureString $secure
  [IO.File]::WriteAllText((Join-Path $root $files[$key]),$encrypted,(New-Object Text.UTF8Encoding($false)))
 }
} finally {$rng.Dispose()}
$sha=[Security.Cryptography.SHA256]::Create()
$digests=@{}
try {
 foreach($key in $values.Keys) { $digests[$key]=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($values[$key])))).Replace('-','').ToLowerInvariant() }
} finally {$sha.Dispose()}
$intent=@{project=$project;host=$env:COMPUTERNAME;at=(Get-Date -Format o);names=$names;sha256=$digests}
$intent | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'setup-intent.json') -Encoding UTF8
$plain=Join-Path $root ('one-shot-'+[guid]::NewGuid().ToString('N')+'.env')
try {
 [IO.File]::WriteAllText($plain,(($values.Keys | ForEach-Object {$_+'='+$values[$_]}) -join "`n"),(New-Object Text.UTF8Encoding($false)))
 # Only the private filename is a process argument. Existing CLI credentials
 # remain on4060; new internal credentials are installed in this Core project.
 $setOutput=& (Get-Command supabase).Source secrets set --project-ref $project --env-file $plain 2>&1
 if ($LASTEXITCODE -ne 0) { throw 'SETTINGS_WRITE_UNCERTAIN_READBACK_REQUIRED' }
 $actualRaw=& (Get-Command supabase).Source secrets list --project-ref $project --output json 2>$null
 if ($LASTEXITCODE -ne 0) { throw 'SETTINGS_POST_WRITE_READBACK_REQUIRED' }
 $actual=$actualRaw | ConvertFrom-Json
 foreach($key in $names) {
  $row=@($actual | Where-Object {$_.name -ceq $key})
  if ($row.Count -ne 1 -or $row[0].digest.ToLowerInvariant() -cne $digests[$key]) { throw 'SETTINGS_DIGEST_MISMATCH' }
 }
 $receipt=@{decision='BROKER_SETTINGS_INSTALLED_AND_DIGEST_VERIFIED';project=$project;setting_count=8;
  host=$env:COMPUTERNAME;at=(Get-Date -Format o);credential_values_logged=$false;existing_credentials_copied=$false}
 $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'setup-receipt.json') -Encoding UTF8
 $receipt | ConvertTo-Json -Compress
} finally {
 $resolved=[IO.Path]::GetFullPath($plain)
 if ([IO.Path]::GetDirectoryName($resolved) -cne [IO.Path]::GetFullPath($root)) { throw 'PRIVATE_CLEANUP_PATH_REJECTED' }
 if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Force }
 $values.Clear();$setOutput=$null
}
