@echo off
setlocal
chcp 65001 >nul
title 莲花广麻 App 构建
cd /d "%~dp0"
if exist "lianhuaguangdongmahjong\package.json" cd /d "%~dp0lianhuaguangdongmahjong"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-windows.ps1" -Target android %*
set "BUILD_EXIT=%ERRORLEVEL%"
echo.
if not defined MAHJONG_BUILD_NO_PAUSE pause
exit /b %BUILD_EXIT%
