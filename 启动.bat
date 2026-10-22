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

REM Free port 7000 if a previous instance is still listening
call :free_port 7000

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
exit /b


REM ---------------------------------------------------------------
REM :free_port <port>
REM Kill only a *python* process listening on <port>, then wait for
REM the socket to be released. Non-python holders are left alone.
REM ---------------------------------------------------------------
:free_port
setlocal enabledelayedexpansion
set "KILLED=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%~1 " ^| findstr /i "LISTENING"') do (
    if not "%%p"=="0" (
        set "IMAGENAME=?"
        for /f "tokens=1" %%n in ('tasklist /FI "PID eq %%p" /NH 2^>nul') do set "IMAGENAME=%%n"
        echo !IMAGENAME! | findstr /i "python" >nul
        if not errorlevel 1 (
            echo [Port %~1] stopping previous instance: PID=%%p ^(!IMAGENAME!^)
            taskkill /F /PID %%p >nul 2>&1
            set "KILLED=1"
        ) else (
            echo [Port %~1] PID=%%p ^(!IMAGENAME!^) is not python - skipped
        )
    )
)
if "!KILLED!"=="1" (
    echo [Port %~1] waiting for socket release...
    for /l %%i in (1,1,15) do (
        netstat -ano | findstr ":%~1 " | findstr /i "LISTENING" >nul
        if errorlevel 1 goto :port_free
        timeout /t 1 /nobreak >nul
    )
    echo [Port %~1] WARNING: port still busy
    goto :port_free
)
:port_free
endlocal
goto :eof
