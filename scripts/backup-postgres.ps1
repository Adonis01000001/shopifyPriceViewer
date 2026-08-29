[CmdletBinding()]
param(
  [string]$OutputDirectory = "backups"
)

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL must be set in the environment."
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump was not found. Install PostgreSQL client tools or use the managed provider backup workflow."
}

$resolvedDirectory = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
}

New-Item -ItemType Directory -Force -Path $resolvedDirectory | Out-Null
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$backupPath = Join-Path $resolvedDirectory "pricevision-$timestamp.dump"

& pg_dump --dbname=$env:DATABASE_URL --format=custom --no-owner --no-privileges --file=$backupPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE. The partial backup, if any, was preserved for inspection: $backupPath"
}

Write-Output "PostgreSQL backup created: $backupPath"
