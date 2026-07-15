#requires -Version 5.1
<#
  backup.ps1 — Windows analogue of scripts/backup.sh. Dumps the Postgres DB and the
  uploads volume into .\backups\ (gitignored), compresses with native Compress-Archive
  (no host gzip), keeps the last 14 of each artifact class, and optionally mirrors new
  artifacts into a OneDrive-synced folder. Tolerates "app not running / no uploads yet".
#>
[CmdletBinding()]
param([string]$OneDriveBackupPath = $env:ONEDRIVE_BACKUP_PATH)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo
$backups = Join-Path $repo 'backups'
New-Item -ItemType Directory -Force -Path $backups | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'

# --- DB dump (plain SQL) → zip ---
# Dump to a file INSIDE the db container, then byte-copy it out with `docker compose cp`.
# The UTF-8 dump must NEVER transit a PowerShell string: Windows PowerShell 5.1 decodes
# native-command stdout with the legacy OEM/ANSI code page (not UTF-8), so capturing
# pg_dump's output into a variable mojibake's every multi-byte character (chat emoji +
# reactions, CJK/accented member names, non-ASCII org + Files document titles) BEFORE it is
# ever written to disk. `docker compose cp` copies raw bytes and is encoding-agnostic.
# --clean --if-exists makes the dump SELF-CLEANING: it drops each object before
# recreating it, so a catastrophe restore can pipe straight into a populated DB
# (docs/ops/ops-card.md) without CREATE TABLE collisions.
$sqlPath = Join-Path $backups "labhub-$stamp.sql"
$zipPath = Join-Path $backups "labhub-$stamp.sql.zip"
Write-Host "Dumping database → $zipPath"
docker compose exec -T db pg_dump --clean --if-exists -U labhub -f /tmp/labhub.sql labhub
if ($LASTEXITCODE -ne 0) {
  docker compose exec -T db rm -f /tmp/labhub.sql 2>$null   # drop any partial dump
  throw 'pg_dump failed (is the db service up?)'
}
docker compose cp db:/tmp/labhub.sql $sqlPath
$copyExit = $LASTEXITCODE
docker compose exec -T db rm -f /tmp/labhub.sql 2>$null     # never leave the dump in the container
if ($copyExit -ne 0) { throw 'copying the dump out of the db container failed' }
Compress-Archive -Path $sqlPath -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $sqlPath -Force
$new = @($zipPath)

# --- Uploads archive (tolerate app down / empty, like backup.sh) ---
$staging = Join-Path $backups "uploads-$stamp"
$upZip = Join-Path $backups "uploads-$stamp.zip"
try {
  docker compose cp app:/data/uploads $staging 2>$null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $staging)) {
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $upZip -Force
    Remove-Item -LiteralPath $staging -Recurse -Force
    $new += $upZip
    Write-Host "Archived uploads → $upZip"
  } else {
    Write-Host 'note: app container not running or no uploads yet — database dumped only.' -ForegroundColor Yellow
  }
} catch {
  Write-Host 'note: uploads copy failed — database dumped only.' -ForegroundColor Yellow
  if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}

# --- Retention: keep the last 14 of each class ---
foreach ($pat in @('labhub-*.sql.zip', 'uploads-*.zip')) {
  Get-ChildItem -LiteralPath $backups -Filter $pat -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

# --- Optional OneDrive mirror ---
if ($OneDriveBackupPath) {
  if (Test-Path $OneDriveBackupPath) {
    foreach ($f in $new) { Copy-Item -LiteralPath $f -Destination $OneDriveBackupPath -Force }
    Write-Host "Mirrored $($new.Count) artifact(s) → $OneDriveBackupPath" -ForegroundColor Green
  } else {
    Write-Host "note: OneDrive path '$OneDriveBackupPath' not found — skipped mirror." -ForegroundColor Yellow
  }
}
Write-Host "Backup complete: $stamp" -ForegroundColor Green
