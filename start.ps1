$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$null = New-Item -ItemType Directory -Path (Join-Path $projectRoot 'data') -Force
$serverReady = $false
try { $null = Invoke-WebRequest 'http://127.0.0.1:4317/' -UseBasicParsing -TimeoutSec 2; $serverReady = $true } catch { }
if (-not $serverReady) {
    $nodeRuntime = 'E:\node\node.exe'
    if (-not (Test-Path -LiteralPath $nodeRuntime)) { $nodeRuntime = (Get-Command node -ErrorAction Stop).Source }
    $runningServer = Start-Process -FilePath $nodeRuntime -ArgumentList @((Join-Path $projectRoot 'server.mjs')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data\server.log') -RedirectStandardError (Join-Path $projectRoot 'data\server-error.log') -PassThru
    [IO.File]::WriteAllText((Join-Path $projectRoot 'data\server.pid'), [string]$runningServer.Id)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $null = Invoke-WebRequest 'http://127.0.0.1:4317/' -UseBasicParsing -TimeoutSec 1; $serverReady = $true; break } catch { }
    }
}
if (-not $serverReady) { throw '拾事启动失败，请查看 data\server-error.log' }
# The Node service starts and supervises its built-in read-only database worker.
Start-Process 'http://127.0.0.1:4317/'
