@echo off
echo ========================================
echo   Start art-canvas + ComfyUI
echo ========================================
echo.

cd /d "%~dp0..\.."

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found in PATH
    pause
    exit /b 1
)

echo [1/2] Starting ComfyUI (port 8188)...
cd /d H:\AI-Tools\ComfyUI-aio-V9.0
start /b "" ".\python\python.exe" -s ComfyUI\main.py --windows-standalone-build --port 8188 --enable-cors-header
cd /d "%~dp0..\.."

echo [2/2] Waiting for ComfyUI...
timeout /t 8 /nobreak >nul

echo Starting art-canvas (port 7000)...
start "" http://127.0.0.1:7000

python main.py

echo.
echo Server stopped.
pause
