#requires -Version 5.1
<#
  rollback.ps1 -Tag vX.Y.Z — return the server to a prior version. Checks out the tag,
  rebuilds the prod stack, and health-gates on that version. Because migrations are
  ADDITIVE ONLY (no down-migrations), rolling CODE back is data-safe: any columns a newer
  tag added simply persist unused — nothing is un-applied. A DB *restore* is for data
  catastrophe only (docs/ops/ops-card.md), NOT part of a version rollback.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Tag, [int]$TimeoutSeconds = 180)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

function Get-AppPort {
  $envFile = Join-Path $repo '.env'
  if (Test-Path $envFile) {
    $line = Select-String -LiteralPath $envFile -Pattern '^\s*APP_PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($line) { return [int]$line.Matches[0].Groups[1].Value }
  }
  return 3000
}
function Get-HealthUrl([int]$port) {
  if ($port -eq 80) { return 'http://localhost/api/health' }
  return "http://localhost:$port/api/health"
}

docker version *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker is not reachable — start Docker Desktop and retry.' -ForegroundColor Red; exit 1 }

$expectVersion = $Tag.TrimStart('v')
Write-Host "Rolling back to $Tag (version $expectVersion) ..."
git fetch --tags --force
git checkout $Tag
if ($LASTEXITCODE -ne 0) { Write-Host "git checkout $Tag failed." -ForegroundColor Red; exit 1 }
docker compose --profile prod up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host 'Rebuild failed — inspect: docker compose --profile prod logs -f app' -ForegroundColor Red; exit 1 }

$url = Get-HealthUrl (Get-AppPort)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 5
    if ($r.version -eq $expectVersion) { Write-Host "SUCCESS — rolled back to $Tag ($expectVersion is live)." -ForegroundColor Green; exit 0 }
  } catch { }
  Start-Sleep -Seconds 3
}
Write-Host "Rolled back code to $Tag but health never confirmed $expectVersion within $TimeoutSeconds s — check: docker compose --profile prod logs -f app" -ForegroundColor Red
exit 1
