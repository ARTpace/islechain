@echo off
echo ========================================
echo   XYMap Project Startup
echo   Using System Python
echo ========================================
echo.

set PROJECT_DIR=%~dp0
set PYTHON_EXE=python

echo Python: %PYTHON_EXE%
%PYTHON_EXE% --version
echo.

cd /d "%PROJECT_DIR%"

echo Starting server...
echo Local: http://127.0.0.1:7000
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r /c:"IPv4"') do set LAN_IP=%%a
set LAN_IP=%LAN_IP: =%
echo LAN:   http://%LAN_IP%:7000
echo.

start http://127.0.0.1:7000

timeout /t 2 /nobreak >nul

"%PYTHON_EXE%" main.py

pause
