#!/bin/bash
# ============================================================
# start.sh · 手动启动服务（前台运行，用于调试）
# 生产环境请使用 systemd：sudo systemctl start kr-teacher
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 端口可通过环境变量覆盖
export PORT="${PORT:-3000}"

# 检测 Node.js
if ! command -v node &> /dev/null; then
  echo "[ERROR] 未检测到 Node.js，请先运行 ./install.sh"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[ERROR] Node.js 版本 $(node -v) 过低，需要 v22+"
  exit 1
fi

mkdir -p data

echo "启动科任教师工作台（端口 $PORT）..."
echo "按 Ctrl+C 停止"
echo ""

exec node --disable-warning=ExperimentalWarning server.js
