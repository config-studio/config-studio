# Config Studio Dual-Edition Build & Packager Script
param (
    [string]$Target = "all"
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

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Config Studio Multi-Edition Compilation & Packager      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Build Standalone cspkg CLI Packager and Remote Agent Daemon
Write-Host "`n[1/4] Building Standalone cspkg CLI Packager & Remote Agent Daemon..." -ForegroundColor Yellow
Set-Location $RootDir
$cspkgPath = Join-Path $BinDir "cspkg.exe"
go build -ldflags "-s -w" -o "$cspkgPath" ./cmd/cspkg
Write-Host "[OK] Built bin/cspkg.exe" -ForegroundColor Green

$agentPath = Join-Path $BinDir "config-studio-agent.exe"
go build -ldflags "-s -w" -o "$agentPath" ./cmd/agent
Write-Host "[OK] Built bin/config-studio-agent.exe" -ForegroundColor Green

# 2. Build Russian Edition
if ($Target -eq "all" -or $Target -eq "ru") {
    Write-Host "`n[2/4] Building Russian UI Edition (RU)..." -ForegroundColor Yellow
    Set-Location $WebDir
    npm.cmd run build:ru
    
    Set-Location $RootDir
    $ruExe = Join-Path $BinDir "config-studio-ru-windows-amd64.exe"
    $mainExe = Join-Path $BinDir "config-studio-windows-amd64.exe"
    go build -ldflags "-s -w" -o "$ruExe" ./cmd/server
    Copy-Item -Path "$ruExe" -Destination "$mainExe" -Force
    Write-Host "[OK] Built $ruExe (and $mainExe)" -ForegroundColor Green
}

# 3. Build English Edition
if ($Target -eq "all" -or $Target -eq "en") {
    Write-Host "`n[3/4] Building English UI Edition (EN)..." -ForegroundColor Yellow
    Set-Location $WebDir
    npm.cmd run build:en
    
    Set-Location $RootDir
    $enExe = Join-Path $BinDir "config-studio-en-windows-amd64.exe"
    go build -ldflags "-s -w" -o "$enExe" ./cmd/server
    Write-Host "[OK] Built $enExe" -ForegroundColor Green
}

# 4. Copy to Target Distribution Folders
Write-Host "`n[4/4] Deploying to target desktop distribution paths..." -ForegroundColor Yellow
foreach ($dest in $DistDirs) {
    if (Test-Path $dest) {
        try {
            Copy-Item -Path (Join-Path $BinDir "config-studio-windows-amd64.exe") -Destination $dest -Force -ErrorAction Stop
            Copy-Item -Path (Join-Path $BinDir "config-studio-windows-amd64.exe") -Destination (Join-Path $dest "config-studio.exe") -Force -ErrorAction Stop
            Copy-Item -Path (Join-Path $BinDir "config-studio-ru-windows-amd64.exe") -Destination $dest -Force -ErrorAction Stop
            Copy-Item -Path (Join-Path $BinDir "config-studio-en-windows-amd64.exe") -Destination $dest -Force -ErrorAction Stop
            Copy-Item -Path (Join-Path $BinDir "cspkg.exe") -Destination $dest -Force -ErrorAction Stop
            Copy-Item -Path (Join-Path $BinDir "config-studio-agent.exe") -Destination $dest -Force -ErrorAction Stop
            Copy-Item -Path (Join-Path $RootDir "start.bat") -Destination $dest -Force -ErrorAction SilentlyContinue

            # Deploy latest extension packages (.cspkg)
            $destPlugins = Join-Path $dest "data\plugins"
            if (-not (Test-Path $destPlugins)) {
                New-Item -ItemType Directory -Path $destPlugins -Force | Out-Null
            }
            $pluginsPkgDir = "C:\Users\iBella\.gemini\antigravity\scratch\config-studio-plugins\packages"
            if (Test-Path $pluginsPkgDir) {
                Copy-Item -Path (Join-Path $pluginsPkgDir "servers.cspkg") -Destination (Join-Path $destPlugins "servers.cspkg") -Force -ErrorAction SilentlyContinue
                Copy-Item -Path (Join-Path $pluginsPkgDir "servers.cspkg") -Destination (Join-Path $dest "servers.cspkg") -Force -ErrorAction SilentlyContinue
            }
            Write-Host "[OK] Deployed binaries to: $dest" -ForegroundColor Green
        } catch {
            Write-Host "[WARN] Could not deploy to $dest (file is in use): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

Write-Host "`nCompilation & Distribution completed successfully!" -ForegroundColor Cyan
