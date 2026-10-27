#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the MarketForge real-listing preview server and opens it in your browser.

.DESCRIPTION
  Launches preview-listing.js (read-only, no server.js, no tracking, no payments),
  waits for the ephemeral port to be reported, prints both preview URLs, and opens
  the listing page in your default browser.

.EXAMPLE
  cd C:\Users\juanm\Desktop\marketforge-local
  .\start-preview.ps1
#>

$ErrorActionPreference = 'Stop'

# ── Pre-flight checks ─────────────────────────────────────────────────────────
$script = Join-Path $PSScriptRoot 'preview-listing.js'
if (-not (Test-Path $script)) {
    Write-Host "ERROR: preview-listing.js not found in $PSScriptRoot" -ForegroundColor Red
    Write-Host "       Run this script from the marketforge-local project directory." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node.exe not found in PATH. Install Node.js and try again." -ForegroundColor Red
    exit 1
}

# ── Start the preview server ──────────────────────────────────────────────────
$outFile = [System.IO.Path]::GetTempFileName()
$errFile = [System.IO.Path]::GetTempFileName()

Write-Host "Starting listing preview..." -NoNewline

try {
    $proc = Start-Process `
        -FilePath        'node' `
        -ArgumentList    "`"$script`"" `
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

# ── Wait up to 10 s for the port line ────────────────────────────────────────
$port     = $null
$deadline = (Get-Date).AddSeconds(10)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300

    # Bail early if the process exited before printing the port
    if ($proc.HasExited) { break }

    if (-not (Test-Path $outFile)) { continue }
    $content = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
    if ($content -and $content -match 'REAL_LISTING_PREVIEW port=(\d+)') {
        $port = $Matches[1]
        break
    }
}

Remove-Item $outFile -ErrorAction SilentlyContinue

# ── Report failure with stderr output ─────────────────────────────────────────
if (-not $port) {
    Write-Host ""
    Write-Host "ERROR: Preview did not start within 10 seconds." -ForegroundColor Red
    $errContent = if (Test-Path $errFile) { Get-Content $errFile -Raw -ErrorAction SilentlyContinue } else { '' }
    if ($errContent) {
        Write-Host $errContent -ForegroundColor Red
    }
    Remove-Item $errFile -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) { $proc.Kill() }
    exit 1
}

Remove-Item $errFile -ErrorAction SilentlyContinue

# ── Print URLs and open browser ───────────────────────────────────────────────
$listingUrl  = "http://127.0.0.1:$port/"
$checkoutUrl = "http://127.0.0.1:$port/checkout?checkin=2027-01-08&checkout=2027-01-10"

Write-Host " ready  (PID $($proc.Id))" -ForegroundColor Green
Write-Host ""
Write-Host "  Listing:  $listingUrl"  -ForegroundColor Cyan
Write-Host "  Checkout: $checkoutUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening listing in your default browser..."
Write-Host "(Press Ctrl+C or close this window to stop the preview server.)"
Write-Host ""

Start-Process $listingUrl

# Keep the script alive so the user sees the URLs; the node process is
# independent and keeps running until they close this terminal window or
# stop the node process themselves.
Write-Host "Preview server running. Press Enter to exit this launcher (server stays up)."
$null = Read-Host
