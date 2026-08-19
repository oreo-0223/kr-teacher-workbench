#!/bin/bash
# ============================================================
# deploy.sh · 一键部署脚本（Ubuntu / Debian）
# 功能：检测 Node.js → 安装 systemd 服务 → 启动服务
# 用法：chmod +x deploy.sh && ./deploy.sh
# ============================================================
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
SERVICE_NAME="kr-teacher"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "  ============================================"
echo "    科任教师工作台 — Ubuntu 一键部署"
echo "  ============================================"
echo ""

# ---------- 1. 检测 root 权限 ----------
if [ "$EUID" -ne 0 ]; then
  warn "未以 root 身份运行，systemd 安装步骤将需要 sudo"
  SUDO="sudo"
else
  SUDO=""
fi

# ---------- 2. 检测 Node.js ----------
info "检测 Node.js 环境..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 22 ]; then
    info "Node.js $(node -v) — 满足要求 (>= v22)"
  else
    error "Node.js 版本 $(node -v) 过低，需要 v22+"
    echo ""
    echo "  安装 Node.js 22 的方法："
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -"
    echo "    sudo apt-get install -y nodejs"
    echo ""
    exit 1
  fi
else
  error "未检测到 Node.js，正在尝试自动安装..."
  echo ""
  info "通过 NodeSource 安装 Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 22 ]; then
    info "Node.js $(node -v) 安装成功"
  else
    error "Node.js 安装失败，请手动安装 v22+"
    exit 1
  fi
fi

# ---------- 3. 创建数据目录 ----------
info "确保数据目录存在..."
mkdir -p "$SERVER_DIR/data"

# ---------- 4. 安装 systemd 服务 ----------
info "安装 systemd 服务..."
cat > /tmp/${SERVICE_NAME}.service << EOF
[Unit]
Description=KR Teacher Workbench Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${SERVER_DIR}
ExecStart=$(which node) --disable-warning=ExperimentalWarning server.js
Environment=PORT=3000
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

$SUDO cp /tmp/${SERVICE_NAME}.service "$SERVICE_FILE"
$SUDO systemctl daemon-reload
$SUDO systemctl enable ${SERVICE_NAME}
info "systemd 服务已安装并设为开机自启"

# ---------- 5. 启动服务 ----------
info "启动服务..."
$SUDO systemctl restart ${SERVICE_NAME}
sleep 2

# ---------- 6. 验证 ----------
if $SUDO systemctl is-active --quiet ${SERVICE_NAME}; then
  info "服务启动成功！"
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║     科任教师工作台 — 部署完成               ║"
  echo "  ╠══════════════════════════════════════════════╣"
  
  # 获取本机 IP
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  
  echo "  ║  本机访问：  http://localhost:3000          ║"
  if [ -n "$LOCAL_IP" ]; then
    echo "  ║  局域网访问：http://${LOCAL_IP}:3000"
  fi
  echo "  ║                                              ║"
  echo "  ║  常用命令：                                  ║"
  echo "  ║    查看状态：sudo systemctl status ${SERVICE_NAME}"
  echo "  ║    停止服务：sudo systemctl stop ${SERVICE_NAME}"
  echo "  ║    重启服务：sudo systemctl restart ${SERVICE_NAME}"
  echo "  ║    查看日志：sudo journalctl -u ${SERVICE_NAME} -f"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""
  
  warn "如需外网访问，请配置 frp 内网穿透（参考 README.md）"
  echo ""
else
  error "服务启动失败，查看日志："
  $SUDO journalctl -u ${SERVICE_NAME} -n 20 --no-pager
  exit 1
fi
