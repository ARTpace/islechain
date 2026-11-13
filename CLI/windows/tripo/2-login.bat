@echo off
chcp 65001 >nul
title Tripo CLI - Login
echo Signing in to Tripo (ov / developers.tripo3d.ai)...
echo A browser window will open; confirm the one-time code there.
echo.
tripo login --region ov
echo.
echo --- account ---
tripo whoami
echo.
echo --- doctor ---
tripo doctor
echo.
echo Done. Close this window and click Verify in CLI settings.
pause
