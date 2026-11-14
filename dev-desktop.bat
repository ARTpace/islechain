@echo off
rem ============================================================
rem  IsleChain desktop dev entry (run from repo root, portable)
rem    dev-desktop.bat               -> backend + Tauri studio window
rem    dev-desktop.bat --overlay     -> plus transparent overlay probe
rem    dev-desktop.bat --no-server   -> reuse the backend already on :7000
rem    dev-desktop.bat --server-only -> backend only, no window
rem  Keep this window open; Ctrl+C stops everything.
rem ============================================================
setlocal
cd /d "%~dp0"
call "desktop\scripts\start-desktop.cmd" %*
endlocal
