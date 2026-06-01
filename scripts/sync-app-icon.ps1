$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

python (Join-Path $PSScriptRoot "prepare-app-icon.py")

$source = Join-Path $PWD "app-icon.png"
if (-not (Test-Path $source)) {
  throw "App-Icon nicht gefunden: $source"
}

npm run tauri -- icon $source

python (Join-Path $PSScriptRoot "prepare-app-icon.py") --ico-only

Write-Host "Transparent app icon synced (PNG + Tauri + ICO)."
