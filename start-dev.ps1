#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the MarketForge development preview with auto-restart on file changes.

.DESCRIPTION
  Launches dev-preview.js, which:
    - Holds a stable URL (http://127.0.0.1:4321/) that never changes.
    - Watches preview-listing.js for edits and restarts the preview automatically.
    - Reloads open browser tabs via SSE when the preview restarts.

  Use start-preview.ps1 for a plain one-shot preview with no file watching.

.EXAMPLE
  cd C:\Users\juanm\Desktop\marketforge-local
  .\start-dev.ps1

.NOTES
  Set the DEV_PORT environment variable before running to use a different port:
    $env:DEV_PORT = 5000; .\start-dev.ps1
#>

$ErrorActionPreference = 'Stop'

# ── Pre-flight checks ──────────────────────────────────────────────────────────
$devScript = Join-Path $PSScriptRoot 'dev-preview.js'
if (-not (Test-Path $devScript)) {
    Write-Host "ERROR: dev-preview.js not found in $PSScriptRoot" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node.exe not found in PATH. Install Node.js and try again." -ForegroundColor Red
    exit 1
}

# ── Launch dev-preview.js ──────────────────────────────────────────────────────
$outFile = [System.IO.Path]::GetTempFileName()
$errFile = [System.IO.Path]::GetTempFileName()

Write-Host "Starting dev preview (watches for file changes)..." -NoNewline

try {
    $proc = Start-Process `
        -FilePath        'node' `
        -ArgumentList    "`"$devScript`"" `
        -WorkingDirectory $PSScriptRoot `
        -RedirectStandardOutput $outFile `
        -RedirectStandardError  $errFile `
        -PassThru `
        -WindowStyle Hidden
} catch {
    Write-Host ""
    Write-Host "ERROR: Could not launch node: $_" -ForegroundColor Red
    exit 1
}

# ── Wait up to 12 s for the ready signal ──────────────────────────────────────
$port     = $null
$deadline = (Get-Date).AddSeconds(12)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300

    if ($proc.HasExited) { break }

    $content = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    if ($content -and $content -match 'DEV_PREVIEW_READY port=(\d+)') {
        $port = $Matches[1]
        break
    }
}

Remove-Item $outFile -ErrorAction SilentlyContinue

if (-not $port) {
    Write-Host ""
    Write-Host "ERROR: Dev preview did not start within 12 seconds." -ForegroundColor Red
    $errContent = if (Test-Path $errFile) { Get-Content $errFile -Raw -ErrorAction SilentlyContinue } else { '' }
    if ($errContent) { Write-Host $errContent -ForegroundColor Red }
    Remove-Item $errFile -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) { $proc.Kill() }
    exit 1
}

Remove-Item $errFile -ErrorAction SilentlyContinue

# ── Print URLs and open browser ────────────────────────────────────────────────
$listingUrl  = "http://127.0.0.1:$port/"
$checkoutUrl = "http://127.0.0.1:$port/checkout?checkin=2027-01-08&checkout=2027-01-10&adults=1"

# Detect LAN IP for phone access - prefer Wi-Fi, fall back to any non-loopback adapter
$lanIP = $null
try {
    $wifiIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
               Where-Object { $_.InterfaceAlias -like '*Wi-Fi*' -and $_.PrefixOrigin -ne 'WellKnown' } |
               Select-Object -First 1).IPAddress
    if ($wifiIP) {
        $lanIP = $wifiIP
    } else {
        $lanIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                  Where-Object { -not $_.InterfaceAlias.StartsWith('Loopback') -and $_.PrefixOrigin -ne 'WellKnown' } |
                  Select-Object -First 1).IPAddress
    }
} catch {}

Write-Host " ready  (PID $($proc.Id))" -ForegroundColor Green
Write-Host ""
Write-Host "  PC (listing):   $listingUrl"  -ForegroundColor Cyan
Write-Host "  PC (checkout):  $checkoutUrl" -ForegroundColor Cyan
if ($lanIP) {
    Write-Host ""
    Write-Host "  Phone / tablet (same Wi-Fi):" -ForegroundColor Yellow
    Write-Host "    Listing:   http://${lanIP}:$port/"           -ForegroundColor Yellow
    Write-Host "    Checkout:  http://${lanIP}:$port/checkout?checkin=2027-01-08&checkout=2027-01-10&adults=1" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Edit preview-listing.js and save - the browser reloads automatically."
Write-Host "The URL stays the same across restarts."
Write-Host ""
Write-Host "(Close this window or press Ctrl+C to stop the dev preview.)"
Write-Host ""

Start-Process $listingUrl

Write-Host "Dev preview running. Press Enter to exit this launcher (server stays up)."
$null = Read-Host
