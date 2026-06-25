@echo off
echo ========================================
echo   XYMap Project Startup
echo ========================================
echo.

cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found in PATH
    echo Please install Python 3.10+ or add it to PATH
    pause
    exit /b 1
)

python --version
echo.

echo Checking port 7000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :7000 ^| findstr LISTENING') do (
    echo Killing process %%a on port 7000...
    taskkill /F /PID %%a >nul 2>&1
)
echo.

echo Starting server...
echo Local: http://127.0.0.1:7000
echo.

start "" http://127.0.0.1:7000

timeout /t 2 /nobreak >nul

python main.py

pause
