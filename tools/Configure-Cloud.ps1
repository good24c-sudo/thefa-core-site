param([string]$Project='thefa-core-console',[string]$Team='thefa',[string]$ProjectRef='cgrppxfdurpzzfvkmfte',[switch]$MailKeyFromStdin)
$ErrorActionPreference='Stop'
if($Project -ne 'thefa-core-console' -or $Team -ne 'thefa' -or $ProjectRef -ne 'cgrppxfdurpzzfvkmfte'){throw 'DEDICATED_PROJECT_ONLY'}
# Existing credentials stay in memory and are piped to the dedicated server environment.
$keyJson=& supabase projects api-keys --project-ref $ProjectRef --output json 2>$null
if($LASTEXITCODE -ne 0){throw 'DATABASE_KEY_ACCESS_FAILED'}
$keyRows=$keyJson | ConvertFrom-Json
$serviceKey=[string]($keyRows | Where-Object name -eq 'service_role' | Select-Object -First 1).api_key
if($serviceKey.Length -lt 20){throw 'SERVER_DATABASE_KEY_UNAVAILABLE'}
if(!$MailKeyFromStdin){throw 'DEDICATED_SENDING_KEY_REQUIRED'}
Write-Output 'Ready for restricted sending credential on stdin.'
$secureMailKey=Read-Host 'Restricted sending key' -AsSecureString
$keyPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureMailKey)
try{$mailKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)}
$secureMailKey.Dispose()
if(!$mailKey -or !$mailKey.StartsWith('re_')){throw 'DEDICATED_SENDING_KEY_UNAVAILABLE'}
$secret=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$values=[ordered]@{SUPABASE_URL="https://$ProjectRef.supabase.co";SUPABASE_SERVICE_ROLE_KEY=$serviceKey;RESEND_API_KEY=$mailKey;CORE_OTP_SECRET=$secret;CORE_CONSOLE_ORIGIN='https://thefa-core-console.vercel.app'}
foreach($entry in $values.GetEnumerator()){
  $entry.Value | & vercel env add $entry.Key production --sensitive --project $Project --scope $Team --yes
  if($LASTEXITCODE -ne 0){throw "SERVER_ENV_FAILED_$($entry.Key)"}
}
$values.Clear();$serviceKey=$null;$mailKey=$null;$secret=$null;$managementToken=$null;$keyRows=$null;$keyJson=$null;$authConfig=$null
Write-Output 'Dedicated production environment configured. Credentials were not printed or saved to source.'
