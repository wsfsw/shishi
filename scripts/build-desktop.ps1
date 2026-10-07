param(
 [string]$NodeHome='E:\node',
 [string]$PythonHome="$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python",
 [string]$NodeLicense
)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$output=Join-Path $project 'desktop-build'
$app=Join-Path $output 'app'
if(Test-Path $app){throw 'desktop-build/app already exists; archive it before rebuilding.'}
New-Item -ItemType Directory -Force -Path $app | Out-Null
# Use an explicit source allowlist; never copy the workspace wholesale.
$files=@(Get-ChildItem -LiteralPath $project -File -Filter '*.mjs')
foreach($file in $files){Copy-Item -LiteralPath $file.FullName -Destination $app}
foreach($dir in @('public','scripts','research','vendor')){
 Get-ChildItem -LiteralPath (Join-Path $project $dir) -Recurse -File | Where-Object {$_.Extension -in @('.mjs','.js','.py','.html','.css','.svg','.webp','.md','.txt') -and $_.FullName -notmatch '__pycache__'} | ForEach-Object {
  $relative=$_.FullName.Substring($project.Length+1);$target=Join-Path $app $relative
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $target
 }
}
Copy-Item -LiteralPath (Join-Path $project 'package.json') -Destination $app
$runtime=Join-Path $app 'runtime';$python=Join-Path $runtime 'python'
New-Item -ItemType Directory -Force -Path $python | Out-Null
Copy-Item -LiteralPath (Join-Path $NodeHome 'node.exe') -Destination $runtime
if(!$NodeLicense){$NodeLicense=Join-Path $NodeHome 'LICENSE'}
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $runtime 'NODE-LICENSE.txt')
Get-ChildItem -LiteralPath $PythonHome -File | Where-Object {$_.Extension -in @('.exe','.dll','.txt')} | Copy-Item -Destination $python
foreach($dir in @('DLLs','Lib')){
 Get-ChildItem -LiteralPath (Join-Path $PythonHome $dir) -Recurse -File | Where-Object {$_.FullName -notmatch '\\site-packages\\|\\__pycache__\\' -and $_.Extension -ne '.pyc'} | ForEach-Object {
  $target=Join-Path $python $_.FullName.Substring($PythonHome.Length+1)
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null;Copy-Item -LiteralPath $_.FullName -Destination $target
 }
}
$packages=Join-Path $project '.wechat-venv\Lib\site-packages';$dest=Join-Path $python 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -LiteralPath $packages | Where-Object {$_.Name -match '^(cryptography|cffi|_cffi_backend|pycparser|zstandard|typing_extensions)([.\-_]|$)'} | Copy-Item -Destination $dest -Recurse
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$app\Shishi.exe" "$project\desktop\Shishi.cs"
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed'}
Compress-Archive -Path "$app\*" -DestinationPath "$output\Shishi-Windows.zip" -CompressionLevel Optimal
Get-FileHash -Algorithm SHA256 -LiteralPath "$output\Shishi-Windows.zip"
