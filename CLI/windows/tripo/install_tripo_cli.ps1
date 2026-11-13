$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Keep one global location even when multiple npm/node installs are on PATH.
$env:npm_config_prefix = Join-Path $env:APPDATA 'npm'

Write-Host 'Installing / updating Tripo CLI (npm install -g tripo-cli)...'
& npm.cmd install -g tripo-cli
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host '--- version ---'
& tripo.cmd --version
Write-Host ''
Write-Host '--- doctor ---'
& tripo.cmd doctor
Write-Host ''
Write-Host 'Done. If not signed in, run the login terminal from CLI settings.'
