param(
    [string]$ConsoleDirectory = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'THEFA_Core_Console_V2_Codex_Work')
)
$ErrorActionPreference = 'Stop'
$siteDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$consoleTarget = [IO.Path]::GetFullPath($ConsoleDirectory)
if ($consoleTarget -eq $siteDirectory -or $consoleTarget -eq [IO.Path]::GetPathRoot($consoleTarget)) {
    throw 'ConsoleDirectory must be a separate product directory.'
}
foreach ($taskPort in @(4173, 4174)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue) {
        throw "Port $taskPort is occupied. Existing processes have been preserved."
    }
}
if (Test-Path -LiteralPath $consoleTarget) {
    throw "Console directory exists; preserved without overwrite: $consoleTarget. Run node server.mjs there if already provisioned."
}
New-Item -ItemType Directory -Path $consoleTarget | Out-Null
Copy-Item -Path (Join-Path $siteDirectory 'lab\*') -Destination $consoleTarget -Recurse
$consoleProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.mjs' -WorkingDirectory $consoleTarget -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $consoleTarget 'server.stdout.log') -RedirectStandardError (Join-Path $consoleTarget 'server.stderr.log')
$siteArguments = @('-m', 'http.server', '4174', '--bind', '127.0.0.1', '--directory', ('"' + $siteDirectory + '"'))
$siteProcess = Start-Process -FilePath (Get-Command python.exe).Source -ArgumentList $siteArguments -WorkingDirectory $siteDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $consoleTarget 'website.stdout.log') -RedirectStandardError (Join-Path $consoleTarget 'website.stderr.log')
[pscustomobject]@{
    console = 'http://127.0.0.1:4173'
    website = 'http://127.0.0.1:4174'
    consolePid = $consoleProcess.Id
    websitePid = $siteProcess.Id
    consoleDirectory = $consoleTarget
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $consoleTarget 'local-processes.json') -Encoding utf8
