# Builds FinanzBuddy as a Windows EXE with app icon (app-icon.png in project root).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if ($env:PATH -notlike "*nodejs*") {
  $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
}
if ($env:PATH -notlike "*\.cargo\\bin*") {
  $env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH
}
$env:CARGO_TARGET_DIR = Join-Path $Root "src-tauri\target"

$iconPath = Join-Path $Root "app-icon.png"
if (-not (Test-Path $iconPath)) {
  Write-Error "app-icon.png fehlt im Projektroot: $iconPath"
}

Write-Host "Tauri-Icons aus app-icon.png generieren..."
powershell -ExecutionPolicy Bypass -File scripts/sync-app-icon.ps1

Write-Host "Release-Build starten (dauert einige Minuten)..."
npm run build:app

$releaseExe = Join-Path $Root "src-tauri\target\release\finanzhelfer.exe"
$outDir = Join-Path $Root "release"
$outExe = Join-Path $outDir "Finanzhelfer.exe"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (Test-Path $releaseExe) {
  Copy-Item $releaseExe $outExe -Force
  Write-Host ""
  Write-Host "Fertig! App per Doppelklick starten:"
  Write-Host "  $outExe"
} else {
  $bundled = Get-ChildItem -Path (Join-Path $Root "src-tauri\target\release\bundle") -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*setup*" } |
    Select-Object -First 1
  if ($bundled) {
    Copy-Item $bundled.FullName $outExe -Force
    Write-Host "Fertig! App per Doppelklick starten: $outExe"
  } else {
    Write-Warning "EXE nicht gefunden. Prüfe src-tauri\target\release\"
  }
}
