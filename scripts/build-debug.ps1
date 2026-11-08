# Config Studio Debug Edition Build Script (Local Debug Only — Never in Release CI)
param (
    [switch]$NoDeploy
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$WebDir = Join-Path $RootDir "web"
$BinDir = Join-Path $RootDir "bin"
$DistDirs = @(
    "C:\Users\iBella\Desktop\clash",
    "C:\Users\iBella\Desktop\test"
)

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

Write-Host "==========================================================" -ForegroundColor Red
Write-Host "  Config Studio DEBUG EDITION Compilation (Telemetry Hooked)" -ForegroundColor Red
Write-Host "  Target Binary: config-studio-debug.exe                  " -ForegroundColor Red
Write-Host "==========================================================" -ForegroundColor Red

# 1. Build Web UI in Debug Mode (VITE_DEBUG_TELEMETRY=true)
Write-Host "`n[1/3] Building Web UI with Real-Time Debug Telemetry..." -ForegroundColor Yellow
Set-Location $WebDir
cmd /c "npm run build:debug"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Web build failed with exit code $LASTEXITCODE"
    exit 1
}

# 2. Compile Dedicated Standalone Debug Binary
Write-Host "`n[2/3] Compiling Go server binary: bin/config-studio-debug.exe..." -ForegroundColor Yellow
Set-Location $RootDir
$debugExe = Join-Path $BinDir "config-studio-debug.exe"
go build -ldflags "-s -w" -o "$debugExe" ./cmd/server

if ($LASTEXITCODE -ne 0) {
    Write-Error "Go compilation failed with exit code $LASTEXITCODE"
    exit 1
}
Write-Host "[OK] Successfully compiled: $debugExe" -ForegroundColor Green

# 3. Deploy to Desktop Test Locations
if (-not $NoDeploy) {
    Write-Host "`n[3/3] Deploying config-studio-debug.exe to test environments..." -ForegroundColor Yellow
    foreach ($dest in $DistDirs) {
        if (Test-Path $dest) {
            $destFile = Join-Path $dest "config-studio-debug.exe"
            Copy-Item -Path $debugExe -Destination $destFile -Force
            Write-Host "  -> Deployed to $destFile" -ForegroundColor Cyan
        }
    }
}

# 4. Restore Clean Production Dist (Zero-Artifact Hygiene)
Write-Host "`n[Hygiene] Restoring clean production web/dist..." -ForegroundColor Yellow
Set-Location $WebDir
cmd /c "npm run build:ru"

Write-Host "`n[OK] Config Studio Debug Edition is ready!" -ForegroundColor Green
Write-Host "  Run: node scripts/debug-server.js to start receiving live telemetry on port 9998" -ForegroundColor Green
Write-Host "  Launch: config-studio-debug.exe in Desktop/clash or Desktop/test" -ForegroundColor Green
