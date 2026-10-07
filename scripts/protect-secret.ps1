param([ValidateSet('Encrypt','Decrypt')][string]$Mode)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$text = [Console]::In.ReadToEnd().Trim()
$entropy = [Text.Encoding]::UTF8.GetBytes('shishi.deepseek.v1')
if ($Mode -eq 'Encrypt') {
    $bytes = [Convert]::FromBase64String($text)
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
    $bytes = [Convert]::FromBase64String($text)
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
}
[Console]::Out.Write([Convert]::ToBase64String($result))
