@echo off
chcp 65001 >nul
echo ========================================
echo   XYMap Project Startup
echo ========================================
echo.

cd /d "%~dp0"

rem Prefer Python 3.12 (the one art-canvas was built against)
set PY_EXE=C:\Users\ARTpace\AppData\Local\Programs\Python\Python312\python.exe
if not exist "%PY_EXE%" (
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

echo.
echo Starting server...
echo Local: http://127.0.0.1:7000
echo.

start "" http://127.0.0.1:7000

"%PY_EXE%" main.py

pause
