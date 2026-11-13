@echo off
rem ============================================================
rem  IsleChain desktop launcher (dev mode)
rem    start-desktop.cmd             -> backend + studio window
rem    start-desktop.cmd --overlay   -> plus the transparent overlay probe
rem  Keep this window open: Ctrl+C stops everything.
rem ============================================================
setlocal
title IsleChain Desktop
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
    echo [x] node not found in PATH. Install Node.js 20+ and retry.
    pause
    exit /b 1
)

node "scripts\dev.mjs" %*
set CODE=%ERRORLEVEL%

if not "%CODE%"=="0" (
    echo.
    echo [x] exited with code %CODE%
    pause
)
endlocal
