@echo off
chcp 65001 >nul 2>nul
title 科任教师工作台 - 服务运行中

cd /d "%~dp0"

REM 检测 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo  [错误] 未检测到 Node.js，请先安装 Node.js v22+
    echo  下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 检测 Node.js 版本（需要 v22+ 以支持内置 node:sqlite）
for /f "tokens=1 delims." %%v in ('node --version 2^>nul') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 22 (
    echo  [错误] Node.js 版本过低，需要 v22 或以上版本
    echo  当前版本:
    node --version
    echo  请升级: https://nodejs.org/
    pause
    exit /b 1
)

REM 可自定义端口（修改下面的数字即可）
set PORT=3000

echo.
echo  ════════════════════════════════════════════════
echo   科任教师工作台 - 启动中...
echo  ════════════════════════════════════════════════
echo.
echo  访问地址:  http://localhost:%PORT%
echo  局域网:    http://本机IP:%PORT%
echo.
echo  按 Ctrl+C 可停止服务
echo  ──────────────────────────────────────────────
echo.

node --disable-warning=ExperimentalWarning server.js

echo.
echo  服务已停止。
pause
