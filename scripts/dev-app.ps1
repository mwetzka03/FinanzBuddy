# Entwicklung mit Hot-Reload (Frontend + Rust baut bei Änderungen neu).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if ($env:PATH -notlike "*nodejs*") {
  $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
}
if ($env:PATH -notlike "*\.cargo\bin*") {
  $env:PATH = "$env:USERPROFILE\.cargo\bin;" + $env:PATH
}

Write-Host "FinanzBuddy Dev-Modus (Autobuild) – Beenden mit Strg+C"
Write-Host ""
powershell -ExecutionPolicy Bypass -File scripts/sync-app-icon.ps1
Write-Host ""
npm run tauri dev
