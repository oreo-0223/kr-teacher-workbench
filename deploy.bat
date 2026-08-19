@echo off
chcp 65001 >nul 2>nul
title 科任教师工作台 - 一键部署

echo.
echo  ════════════════════════════════════════════════════════
echo   科任教师工作台 - 一键部署脚本
echo  ════════════════════════════════════════════════════════
echo.

cd /d "%~dp0\server"

REM Step 1: 检测 Node.js
echo  [1/2] 检测运行环境...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  ✗ 未检测到 Node.js！
    echo.
    echo  请先安装 Node.js v22+ ：
    echo    下载地址: https://nodejs.org/
    echo    选择 LTS 版本安装即可
    echo.
    echo  安装完成后重新运行此脚本。
    pause
    exit /b 1
)
echo  √ Node.js 已安装: 
node --version

REM 检测 Node.js 版本
for /f "tokens=1 delims." %%v in ('node --version 2^>nul') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 22 (
    echo.
    echo  ✗ Node.js 版本过低，需要 v22+ 以支持内置 SQLite
    echo  当前版本:
    node --version
    echo  请升级: https://nodejs.org/
    pause
    exit /b 1
)
echo  √ Node.js 版本满足要求（零外部依赖，无需 npm install）

REM Step 2: 启动服务
echo.
echo  [2/2] 启动服务...
echo.
echo  ════════════════════════════════════════════════════════
echo   ✓ 部署完成！服务正在启动...
echo  ════════════════════════════════════════════════════════
echo.
echo  访问地址:  http://localhost:3000
echo  局域网:    http://本机IP:3000
echo.
echo  按 Ctrl+C 停止服务
echo  ──────────────────────────────────────────────
echo.

node --disable-warning=ExperimentalWarning server.js

pause
