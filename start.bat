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

echo Starting server...
echo Local: http://127.0.0.1:7000
echo.

start "" http://127.0.0.1:7000

timeout /t 2 /nobreak >nul

python main.py

pause
