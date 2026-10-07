param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$noticeData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
$noticeIcon = New-Object System.Windows.Forms.NotifyIcon
try {
    $noticeIcon.Icon = [System.Drawing.SystemIcons]::Information
    $noticeIcon.Text = '拾事 · 微信事务箱'
    $noticeIcon.Visible = $true
    $noticeIcon.BalloonTipTitle = [string]$noticeData.title
    $noticeIcon.BalloonTipText = [string]$noticeData.body
    $noticeIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $noticeIcon.ShowBalloonTip(12000)
    $noticeUntil = [DateTime]::UtcNow.AddSeconds(13)
    while ([DateTime]::UtcNow -lt $noticeUntil) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
} finally { $noticeIcon.Visible = $false; $noticeIcon.Dispose() }
