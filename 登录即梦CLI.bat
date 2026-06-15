@echo off
set DREAMINA=%USERPROFILE%\bin\dreamina.exe
echo.
echo === ??CLI?? ===
echo.
"%DREAMINA%" login
"%DREAMINA%" user_credit
if not exist "API" mkdir "API"
echo JIMENG_USE_WSL=0> "API\.env"
echo DREAMINA_BIN=%DREAMINA%>> "API\.env"
echo.
echo ??
pause
