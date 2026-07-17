#requires -Version 5.1
<#
  update.ps1 [-Tag vX.Y.Z] — the one-script patch. Backs up first, checks out the target
  tag (newest by default), rebuilds the prod stack (container start applies any new
  migrations via `prisma migrate deploy`), then polls GET /api/health until the served
  version equals the tag. On any failure it prints the exact rollback + logs commands.
  NEVER pushes; only ever pulls tags.
#>
[CmdletBinding()]
param([string]$Tag, [int]$TimeoutSeconds = 180)
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
function Wait-Health([string]$expectVersion, [int]$timeoutSeconds) {
  $url = Get-HealthUrl (Get-AppPort)
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  Write-Host "Polling $url for version $expectVersion ..."
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri $url -TimeoutSec 5
      if ($r.version -eq $expectVersion) { return $true }
      Write-Host "  serving $($r.version), waiting for $expectVersion ..."
    } catch { Write-Host '  health endpoint not up yet ...' }
    Start-Sleep -Seconds 3
  }
  return $false
}

# 1. Preflight — Docker Desktop running?
docker version *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker is not reachable — start Docker Desktop and retry.' -ForegroundColor Red; exit 1 }

# 2. Record where we are (for the rollback hint) and back up first.
$prevTag = (git tag --points-at HEAD | Select-Object -First 1)
if (-not $prevTag) { $prevTag = (git rev-parse --short HEAD) }
Write-Host "Current version marker: $prevTag"
# backup.ps1 signals failure by THROWING (under $ErrorActionPreference='Stop'), not via a
# non-zero exit code, and $LASTEXITCODE only reflects the last NATIVE command it ran (a
# gracefully-handled `docker compose cp` miss can leave it non-zero on a successful backup).
# So catch a terminating error rather than testing $LASTEXITCODE.
try { & (Join-Path $PSScriptRoot 'backup.ps1') }
catch { Write-Host "Backup failed — aborting update (no patch without a fresh backup): $_" -ForegroundColor Red; exit 1 }

# 3. Fetch tags; resolve the target (default = newest by version sort).
git fetch --tags --force
if (-not $Tag) { $Tag = (git tag --list 'v*' --sort=-v:refname | Select-Object -First 1) }
if (-not $Tag) { Write-Host 'No v* tags found to deploy.' -ForegroundColor Red; exit 1 }
$expectVersion = $Tag.TrimStart('v')
Write-Host "Deploying $Tag (version $expectVersion)"

# 4. Check out the tag (detached) + rebuild the stack.
git checkout $Tag
if ($LASTEXITCODE -ne 0) { Write-Host "git checkout $Tag failed." -ForegroundColor Red; exit 1 }
docker compose --profile prod up -d --build
$built = ($LASTEXITCODE -eq 0)

# 5. Health-gate.
$ok = $false
if ($built) { $ok = Wait-Health $expectVersion $TimeoutSeconds }
if ($ok) { Write-Host "SUCCESS — LabHub $Tag is live (health reports $expectVersion)." -ForegroundColor Green; exit 0 }

# 6. Failure → precise recovery guidance.
Write-Host ''
Write-Host "UPDATE FAILED for $Tag." -ForegroundColor Red
if (-not $built) { Write-Host 'Cause: image build/start failed.' } else { Write-Host "Cause: health never reported $expectVersion within $TimeoutSeconds s." }
Write-Host 'Roll back to the previous version:' -ForegroundColor Yellow
Write-Host "  .\scripts\windows\rollback.ps1 -Tag $prevTag"
Write-Host 'Inspect logs:' -ForegroundColor Yellow
Write-Host '  docker compose --profile prod logs -f app'
exit 1
