@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Config Studio (Debug Telemetry Edition)

:: ---------------------------------------------------------
:: Config Studio Startup & Launcher (Debug Edition)
:: Default: Debug Mode, Plain HTTP (No TLS), Real-Time Telemetry (:9998)
:: ---------------------------------------------------------

:: 1. Default Parameters
set "PORT=8080"
set "WORKDIR=%~dp0."
set "DATADIR=%~dp0data"
set "USE_TLS=0"
set "OPEN_BROWSER=1"
set "LANG_PREF="
set "EXTRA_ARGS="

:: 2. Parse Command Line Arguments
:parse_args
if "%~1"=="" goto after_args

if /i "%~1"=="--help" goto show_help
if /i "%~1"=="-h" goto show_help
if /i "%~1"=="/?" goto show_help
if /i "%~1"=="-?" goto show_help

if /i "%~1"=="--notls" (
    set "USE_TLS=0"
    shift
    goto parse_args
)
if /i "%~1"=="--http" (
    set "USE_TLS=0"
    shift
    goto parse_args
)
if /i "%~1"=="--tls" (
    set "USE_TLS=1"
    shift
    goto parse_args
)
if /i "%~1"=="--https" (
    set "USE_TLS=1"
    shift
    goto parse_args
)
if /i "%~1"=="--nobrowser" (
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
if /i "%~1"=="--no-browser" (
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
if /i "%~1"=="--headless" (
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
if /i "%~1"=="--port" (
    set "PORT=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="-p" (
    set "PORT=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--workdir" (
    set "WORKDIR=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--data" (
    set "DATADIR=%~2"
    shift
    shift
    goto parse_args
)

set "EXTRA_ARGS=!EXTRA_ARGS! %1"
shift
goto parse_args

:after_args

:: 3. Select Debug Binary First
set "EXE="
set "CANDIDATES=config-studio-debug.exe config-studio.exe config-studio-windows-amd64.exe"

for %%F in (!CANDIDATES!) do (
    if not defined EXE if exist "%~dp0%%~F" set "EXE=%~dp0%%~F"
    if not defined EXE if exist "%~dp0bin\%%~F" set "EXE=%~dp0bin\%%~F"
)

if not defined EXE (
    echo ========================================================
    echo  [ERROR] Config Studio executable not found in %~dp0
    echo ========================================================
    echo  config-studio-debug.exe was not found.
    echo ========================================================
    echo.
    pause
    exit /b 1
)

:: 4. Ensure Data Directory Exists
if not exist "!DATADIR!" mkdir "!DATADIR!" 2>nul

:: 5. Ensure Debug Telemetry Server (:9998) is running
curl.exe -s -m 1 http://localhost:9998/health >nul 2>nul
if errorlevel 1 (
    echo [*] Starting background Real-Time Debug Telemetry Server on port 9998...
    start "Config Studio Debug Server (:9998)" /min cmd /c "node C:\Users\iBella\.gemini\antigravity\scratch\config-studio\scripts\debug-server.js"
    timeout /t 1 /nobreak >nul
) else (
    echo [*] Real-Time Debug Telemetry Server is active on http://localhost:9998
)

:: 6. Setup Protocol & Port
set "TLS_FLAG="
set "SCHEME=http"
if "!USE_TLS!"=="1" (
    set "SCHEME=https"
    set "TLS_FLAG=--tls"
)

echo ========================================================
echo   Config Studio (Debug Telemetry Edition)
echo ========================================================
echo   Binary:       !EXE!
echo   Workdir:      !WORKDIR!
echo   Data Dir:     !DATADIR!
echo   Local URL:    !SCHEME!://localhost:!PORT!
echo   Debug Server: http://localhost:9998 (Streaming)
echo   Mode:         Plain HTTP (No TLS)
echo ========================================================
echo.

:: 7. Launch Browser (if enabled)
if "!OPEN_BROWSER!"=="1" (
    start "" cmd /c "timeout /t 2 /nobreak >nul & start !SCHEME!://localhost:!PORT!"
)

:: 8. Run Config Studio Debug Server
"!EXE!" -workdir "!WORKDIR!" -data "!DATADIR!" -port !PORT! !TLS_FLAG! !EXTRA_ARGS!

if errorlevel 1 (
    echo.
    echo ========================================================
    echo  Config Studio stopped with exit code %ERRORLEVEL%.
    echo ========================================================
    pause
)
exit /b %ERRORLEVEL%

:show_help
echo Usage: start.bat [--port 8080] [--nobrowser] [--tls]
pause
exit /b 0
