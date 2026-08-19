@echo off
chcp 65001 >nul 2>nul
title 科任教师工作台 - 停止服务

echo.
echo  正在查找并停止科任教师工作台服务...
echo.

set PORT=3000
set FOUND=0

REM 查找占用端口的进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo  找到进程 PID: %%a
    taskkill /PID %%a /F >nul 2>nul
    if not errorlevel 1 (
        echo  [√] 已停止进程 %%a
        set FOUND=1
    )
)

if "%FOUND%"=="0" (
    echo  [提示] 未找到运行中的服务（端口 %PORT%）
)

echo.
pause
