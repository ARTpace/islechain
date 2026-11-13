@echo off
chcp 65001 >nul
echo ========================================
echo   XYMap Project Startup
echo ========================================
echo.

rem 本脚本位于 scripts/launcher/，项目根在上两级
cd /d "%~dp0..\.."

rem Prefer a local Python install, fall back to PATH
set PY_EXE=
for %%V in (313 312 311 310) do (
    if not defined PY_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
)
if not defined PY_EXE (
    where python >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Python not found in PATH
        echo Please install Python 3.10+ or add it to PATH
        pause
        exit /b 1
    )
    set PY_EXE=python
)

"%PY_EXE%" --version
echo.

echo Checking port 7000...
rem 1) kill leftover art-canvas backend (LISTENING on 7000)
set PORT_BUSY=1
for /l %%i in (1, 1, 3) do (
    if defined PORT_BUSY (
        set PORT_BUSY=
        for /f "tokens=5" %%a in ('netstat -aon ^| findstr :7000 ^| findstr LISTENING') do (
            if not defined PORT_BUSY (
                echo Killing process %%a on port 7000...
                taskkill /F /PID %%a >nul 2>&1
                set PORT_BUSY=1
            )
        )
        if defined PORT_BUSY (
            echo Waiting for socket to release...
            timeout /t 3 /nobreak >nul
        )
    )
)

rem 2) bind test with Python (same condition as uvicorn: catches non-LISTENING usage too, e.g. Doubao outbound)
"%PY_EXE%" -c "import socket; s=socket.socket(); s.bind(('0.0.0.0', 7000)); s.close()" >nul 2>&1
if errorlevel 1 goto port_busy_error
echo Port 7000 is free.
goto port_ok

:port_busy_error
echo.
echo ============================================================
echo  ERROR: Port 7000 is occupied and cannot be used.
echo  The following entries are using port 7000:
echo ------------------------------------------------------------
netstat -aon | findstr :7000
echo ------------------------------------------------------------
echo  Common cause: another program (e.g. Doubao / browser /
echo  or a previous art-canvas instance) holds port 7000.
echo  Close the program listed above, then re-run this script.
echo ============================================================
pause
exit /b 1

:port_ok

echo.
echo Starting server...
echo Local: http://127.0.0.1:7000
echo.

rem clear proxy env that may interfere with httpx
set HTTP_PROXY=
set HTTPS_PROXY=
set SSL_CERT_FILE=
set NO_PROXY=127.0.0.1,localhost,::1,0.0.0.0

rem show LAN IP for other devices
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r /c:"IPv4"') do set LAN_IP=%%a
set LAN_IP=%LAN_IP: =%
if defined LAN_IP echo LAN:   http://%LAN_IP%:7000

rem 1) start backend in a new window (shows logs)
start "" "%PY_EXE%" main.py

rem 2) wait for backend to be ready
timeout /t 5 /nobreak >nul

rem 3) open browser once backend is up
start "" http://127.0.0.1:7000

rem 4) original window exits, only backend window remains
echo.
echo Server started. Close the new window to stop.
