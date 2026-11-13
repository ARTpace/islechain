@echo off
chcp 65001 >nul
title Comfy CLI - Cloud Login
set "COMFY=%~dp0..\..\.venv-comfy\Scripts\comfy.exe"
if not exist "%COMFY%" (
  echo Comfy CLI not found: %COMFY%
  echo Please reinstall comfy-cli into CLI/.venv-comfy
  pause
  exit /b 1
)
echo Signing in to Comfy Cloud (browser OAuth)...
"%COMFY%" cloud login
echo.
"%COMFY%" --json cloud whoami
echo.
echo Done. Close this window and click Verify in CLI settings.
pause
