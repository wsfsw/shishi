$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$collectorRecord = Join-Path $projectRoot 'data\collector.pid'
if (Test-Path -LiteralPath $collectorRecord) {
    $collectorPid = [int][IO.File]::ReadAllText($collectorRecord)
    $collectorProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $collectorPid"
    $collectorScript = Join-Path $projectRoot 'scripts\wechat_collector.py'
    if ($collectorProcess -and $collectorProcess.Name -eq 'python.exe' -and $collectorProcess.CommandLine.Contains($collectorScript)) {
        Stop-Process -Id $collectorPid
    } elseif ($collectorProcess) { throw '采集器进程身份不符，未执行停止。' }
}
$recordFile = Join-Path $projectRoot 'data\server.pid'
if (-not (Test-Path -LiteralPath $recordFile)) { exit }
$servicePid = [int][IO.File]::ReadAllText($recordFile)
$serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid"
$serviceScript = Join-Path $projectRoot 'server.mjs'
if ($serviceProcess -and $serviceProcess.CommandLine.Contains($serviceScript) -and $serviceProcess.Name -eq 'node.exe') {
    & taskkill.exe /PID $servicePid /T /F | Out-Null
    Write-Output '拾事本机服务已停止。事务数据保留，提醒暂时停止。'
} elseif ($serviceProcess) { throw '进程身份不符，未执行停止。' }
