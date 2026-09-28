# Builds the web app into the API and runs the ONE combined server on http://localhost:5080
# (website + API on the same URL). Run from anywhere: powershell -File scripts\run-online.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "Building the web app..." -ForegroundColor Cyan
corepack enable
pnpm install
pnpm --filter '@skb/shared' build
pnpm --filter '@skb/web' build            # relative /api → served same-origin

$dest = Join-Path $root "apps\api\src\SKB.Api\wwwroot"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $root "apps\web\dist\*") $dest

Write-Host "Starting the server on http://localhost:5080 ..." -ForegroundColor Green
Set-Location (Join-Path $root "apps\api\src\SKB.Api")
dotnet run
