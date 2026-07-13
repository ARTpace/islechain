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

rem 环境安全: 清除可能干扰 httpx 的环境变量
set HTTP_PROXY=
set HTTPS_PROXY=
set SSL_CERT_FILE=
set NO_PROXY=127.0.0.1,localhost,::1,0.0.0.0

rem 显示 LAN IP（方便其他设备访问）
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r /c:"IPv4"') do set LAN_IP=%%a
set LAN_IP=%LAN_IP: =%
if defined LAN_IP echo LAN:   http://%LAN_IP%:7000

rem 1) 新窗口启动后端(和启动.bat一样标准启动,能看到日志)
start "" "%PY_EXE%" main.py

rem 2) 等后端就绪
timeout /t 5 /nobreak >nul

rem 3) 后端就绪后打开浏览器
start "" http://127.0.0.1:7000

rem 4) 原窗口自动退出,只保留后端窗口
echo.
echo Server started. Close the new window to stop.
