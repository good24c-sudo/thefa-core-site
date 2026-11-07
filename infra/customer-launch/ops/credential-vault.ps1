$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$vaultStep = 'INPUT'
# Private stdin/stdout transport for the installed owner process. Never invoke
# Read interactively: its stdout is consumed only in memory by credential-io.mjs.
try {
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    Add-Type -AssemblyName System.Security
    $inputObject = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $directory = [IO.Path]::GetFullPath([string]$inputObject.directory)
    $name = [string]$inputObject.name
    if ($name -notmatch '^[a-f0-9-]{36}\.(secret|rollback|intent)\.dpapi$') { throw 'INVALID_NAME' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    if (-not [IO.Directory]::Exists($directory)) {
        $vaultStep = 'CREATE_DIRECTORY'
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner($sid)
        foreach ($identity in @($sid, $system)) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        [void][IO.Directory]::CreateDirectory($directory, $acl)
    }
    # Reject junctions/symlinks, including ancestors, before reading a secret.
    $vaultStep = 'VERIFY_DIRECTORY'
    $cursor = [IO.DirectoryInfo]::new($directory)
    while ($null -ne $cursor) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
        $cursor = $cursor.Parent
    }
    $acl = Get-Acl -LiteralPath $directory
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'UNPROTECTED_VAULT' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid.Value, $system.Value)) { throw 'EXCESS_VAULT_ACCESS' }
    }
    $file = [IO.Path]::Combine($directory, $name)
    $entropy = [Text.Encoding]::UTF8.GetBytes('THEFA_CUSTOMER_STAGE2:' + $name)
    if ($inputObject.operation -eq 'WriteNew') {
        $vaultStep = 'PROTECT_AND_WRITE'
        $bytes = [Text.Encoding]::UTF8.GetBytes([string]$inputObject.value)
        try {
            $cipher = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, 'CurrentUser')
            $stream = [IO.File]::Open($file, 'CreateNew', 'Write', 'None')
            try { $stream.Write($cipher, 0, $cipher.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
        [Console]::Out.Write('{"stored":true}')
    } elseif ($inputObject.operation -eq 'Read') {
        $vaultStep = 'VERIFY_AND_READ'
        if ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
        $fileAcl = Get-Acl -LiteralPath $file
        if ($fileAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'WRONG_FILE_OWNER' }
        foreach ($rule in $fileAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid.Value, $system.Value)) { throw 'EXCESS_FILE_ACCESS' }
        }
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file), $entropy, 'CurrentUser')
        try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes)) } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    } else { throw 'INVALID_OPERATION' }
} catch {
    # Do not print exception bodies, paths, SQL, stdin or provider responses.
    [Console]::Error.Write('CUSTOMER_CREDENTIAL_VAULT_FAILED:' + $vaultStep + ':' + $_.Exception.GetType().Name + ':L' + $_.InvocationInfo.ScriptLineNumber)
    exit 1
}
