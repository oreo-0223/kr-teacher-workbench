@echo off
chcp 65001 >nul 2>nul
title 科任教师工作台 - 环境检测

echo.
echo  ════════════════════════════════════════════════
echo   科任教师工作台 - 环境检测
echo  ════════════════════════════════════════════════
echo.

cd /d "%~dp0"

REM 检测 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo  [错误] 未检测到 Node.js！
    echo.
    echo  请先安装 Node.js v22 或以上版本：
    echo  下载地址: https://nodejs.org/
    echo  选择 LTS 版本，安装时勾选 "Add to PATH"
    echo.
    pause
    exit /b 1
)

echo  [√] 检测到 Node.js:
node --version
echo.

REM 检测 Node.js 版本
for /f "tokens=1 delims." %%v in ('node --version 2^>nul') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 22 (
    echo  [错误] Node.js 版本过低，需要 v22 或以上版本以支持内置 SQLite
    echo  当前版本:
    node --version
    echo  请升级: https://nodejs.org/
    pause
    exit /b 1
)

echo  [√] Node.js 版本满足要求（v22+，内置 SQLite 支持）
echo.
echo  ════════════════════════════════════════════════
echo   [√] 环境检测完成！本项目零外部依赖，无需安装 npm 包
echo  ════════════════════════════════════════════════
echo.
echo  下一步：运行 start.bat 启动服务
echo.
pause
