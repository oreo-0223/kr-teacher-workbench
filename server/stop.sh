#!/bin/bash
# ============================================================
# stop.sh · 停止服务
# 优先使用 systemd 停止，回退到查找进程方式
# ============================================================

SERVICE_NAME="kr-teacher"

# 方式 1：systemd
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "通过 systemd 停止服务..."
  sudo systemctl stop "$SERVICE_NAME"
  echo "服务已停止"
  exit 0
fi

# 方式 2：查找占用 3000 端口的进程
PORT="${PORT:-3000}"
PID=$(lsof -ti :"$PORT" 2>/dev/null || true)

if [ -n "$PID" ]; then
  echo "停止端口 $PORT 上的进程 (PID: $PID)..."
  kill "$PID"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    echo "进程未响应，强制终止..."
    kill -9 "$PID"
  fi
  echo "服务已停止"
else
  echo "未发现运行中的服务"
fi
