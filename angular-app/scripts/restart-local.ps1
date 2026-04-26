$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$apiLog = Join-Path $projectRoot 'api.log'
$apiErr = Join-Path $projectRoot 'api.err'
$uiLog = Join-Path $projectRoot 'ui.log'
$uiErr = Join-Path $projectRoot 'ui.err'
$journalPath = Join-Path $projectRoot 'backend\data\portfolio.db-journal'

function Stop-ListeningPort {
  param([int]$Port)

  $matches = netstat -ano | Select-String ":$Port" | Select-String 'LISTENING'

  foreach ($match in $matches) {
    $parts = ($match.ToString() -split '\s+') | Where-Object { $_ }
    $processId = $parts[-1]

    if ($processId -match '^\d+$') {
      try {
        Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

function Wait-ForHttp {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
    }

    Start-Sleep -Seconds 2
  }

  return $false
}

Write-Host 'Stopping local processes on ports 3000 and 4200...'
Stop-ListeningPort -Port 3000
Stop-ListeningPort -Port 4200

if (Test-Path $journalPath) {
  $backupPath = "$journalPath.bak"
  if (Test-Path $backupPath) {
    Remove-Item -LiteralPath $backupPath -Force
  }

  Rename-Item -LiteralPath $journalPath -NewName ([System.IO.Path]::GetFileName($backupPath)) -Force
}

Write-Host 'Starting backend...'
Start-Process -FilePath $powershellExe `
  -ArgumentList '-NoProfile', '-Command', 'npm run start:api' `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $apiLog `
  -RedirectStandardError $apiErr | Out-Null

Write-Host 'Starting frontend...'
Start-Process -FilePath $powershellExe `
  -ArgumentList '-NoProfile', '-Command', 'npm run start:ui' `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $uiLog `
  -RedirectStandardError $uiErr | Out-Null

$apiReady = Wait-ForHttp -Url 'http://localhost:3000/api/health'
$uiReady = Wait-ForHttp -Url 'http://localhost:4200'

if (-not $apiReady) {
  Write-Host 'Backend did not become ready. Check api.err and api.log.' -ForegroundColor Red
  exit 1
}

if (-not $uiReady) {
  Write-Host 'Frontend did not become ready. Check ui.err and ui.log.' -ForegroundColor Red
  exit 1
}

Write-Host 'Local app restarted successfully.' -ForegroundColor Green
Write-Host 'Frontend: http://localhost:4200'
Write-Host 'Backend:  http://localhost:3000/api/health'
