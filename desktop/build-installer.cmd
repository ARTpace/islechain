@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo  ArtCanvas 桌面安装包 - 一键构建（Tauri / NSIS）
echo ============================================================
echo.

where cargo >nul 2>nul
if errorlevel 1 (
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
  where cargo >nul 2>nul || ( echo 未找到 Rust。请先安装 https://rustup.rs & pause & exit /b 1 )
)

where node >nul 2>nul
if errorlevel 1 ( echo 未找到 Node.js。 & pause & exit /b 1 )
echo [1] Node.js 与 Rust 已就绪。

echo [2] 装配程序源码 ...
node scripts\build-sidecar.mjs
if errorlevel 1 ( echo 装配失败。 & pause & exit /b 1 )

echo [3] 准备内置 Python 并安装依赖 ...
node scripts\build-python.mjs
if errorlevel 1 ( echo Python 运行时准备失败。 & pause & exit /b 1 )

if not exist node_modules\ (
  echo [4] 安装 Tauri 构建工具 ...
  call npm install
  if errorlevel 1 ( echo npm install 失败。 & pause & exit /b 1 )
)

echo [5] 编译桌面程序并生成 NSIS 安装包 ...
call npm run build
if errorlevel 1 ( echo tauri build 失败。 & pause & exit /b 1 )

echo [6] 归档安装包到 desktop\dist ...
if not exist dist\ mkdir dist
copy /y src-tauri\target\release\bundle\nsis\*setup.exe dist\ >nul
if errorlevel 1 ( echo 归档失败。 & pause & exit /b 1 )

echo.
echo ============================================================
echo  完成。安装包：
dir /b dist\*setup.exe
echo ============================================================
echo.
pause
