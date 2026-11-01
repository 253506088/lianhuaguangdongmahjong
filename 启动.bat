@echo off
chcp 65001 >nul
title 莲花广麻前端服务

echo ===================================================
echo             莲花广麻 (广东麻将) 启动程序
echo ===================================================
echo.

cd /d "%~dp0"
if exist "lianhuaguangdongmahjong" cd /d "%~dp0lianhuaguangdongmahjong"

rem 检查并切换到 Node.js 22
where nvm >nul 2>&1
if not errorlevel 1 (
    echo [1/3] 检查并切换 Node.js 到 22...
    call nvm use 22 >nul 2>&1
)

rem 检查 Node.js 是否可用
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请确保已安装 Node.js 或配置好 nvm！
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [信息] 当前使用的 Node.js 版本: %NODE_VER%

rem 检查端口 5173 是否已在运行
netstat -ano | findstr :5173 | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [提示] 端口 5173 已被占用，服务已经在运行中！
    echo 正在为您打开浏览器: http://localhost:5173/
    start http://localhost:5173/
    echo.
    pause
    exit /b 0
)

rem 检查依赖是否已安装
if not exist "node_modules" (
    echo [2/3] 检测到依赖尚未安装，正在安装依赖包，请稍候...
    call npm install
)

echo [3/3] 正在启动 Vite 开发服务器...
echo 服务访问地址: http://localhost:5173/
echo.
echo ===================================================
echo 提示：
echo 1. 稍后会自动在默认浏览器打开游戏界面。
echo 2. 本窗口保持开启即代表服务正在运行。
echo 3. 如需停止服务，可双击运行【停止.bat】或按 Ctrl+C 关闭本窗口。
echo ===================================================
echo.

rem 延迟 2 秒后唤起浏览器
start "" cmd /c "ping 127.0.0.1 -n 3 >nul && start http://localhost:5173/"

rem 启动开发服务器（保持当前窗口前台运行并显示日志）
call npm run dev
