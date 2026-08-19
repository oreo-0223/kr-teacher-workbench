#!/bin/bash
# ============================================================
# install.sh · 环境检测脚本（Ubuntu / Debian）
# 检测 Node.js 版本，如不满足则自动安装
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "  === 环境检测 ==="
echo ""

# 检测 Node.js
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  
  if [ "$NODE_MAJOR" -ge 22 ]; then
    info "Node.js $NODE_VERSION — 满足要求 (>= v22)"
  else
    warn "Node.js $NODE_VERSION — 版本过低，需要 v22+"
    echo ""
    info "正在安装 Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
    sudo apt-get install -y nodejs
    info "Node.js $(node -v) 安装完成"
  fi
else
  warn "未检测到 Node.js"
  info "正在安装 Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
  sudo apt-get install -y nodejs
  info "Node.js $(node -v) 安装完成"
fi

# 检测 npm（仅用于验证，本项目零依赖不需要 npm install）
if command -v npm &> /dev/null; then
  info "npm $(npm -v) — 可用（本项目零依赖，无需 npm install）"
fi

# 确保数据目录存在
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$SCRIPT_DIR/data"
info "数据目录：$SCRIPT_DIR/data"

echo ""
info "环境检测通过！"
echo ""
echo "  启动服务：  ./start.sh"
echo "  或一键部署：cd .. && ./deploy.sh"
echo ""
