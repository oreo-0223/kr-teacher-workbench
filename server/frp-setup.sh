#!/bin/bash
# ============================================================
# frp-setup.sh · frp 内网穿透安装与配置脚本
# 
# 前提条件：
#   1. 已有一台带公网 IP 的云服务器（阿里云/腾讯云轻量服务器）
#   2. 云服务器上已运行 frps（frp 服务端）
#
# 云服务器 frps 配置（frps.toml）参考：
#   bindPort = 7000
#   auth.token = "your-secret-token"
#
# 本脚本在笔记本上执行，安装 frpc 客户端并配置为 systemd 服务
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

FRP_VERSION="0.61.1"
ARCH=$(uname -m)

echo ""
echo "  === frp 内网穿透安装 ==="
echo ""

# ---------- 1. 确认配置 ----------
CONFIG_FILE="$(cd "$(dirname "$0")" && pwd)/frpc.toml"

if [ ! -f "$CONFIG_FILE" ]; then
  error "找不到 frpc.toml 配置文件"
  exit 1
fi

# 检查配置是否已修改
if grep -q "你的云服务器公网IP" "$CONFIG_FILE"; then
  warn "请先编辑 frpc.toml 填写你的云服务器信息："
  echo ""
  echo "  nano $CONFIG_FILE"
  echo ""
  echo "  需要修改的字段："
  echo "    serverAddr → 云服务器公网 IP"
  echo "    auth.token → 与服务端一致的密钥"
  echo "    remotePort → 外网访问端口"
  echo ""
  read -p "修改完成后按回车继续，或输入 q 退出: " confirm
  if [ "$confirm" = "q" ]; then exit 0; fi
fi

# ---------- 2. 下载 frp ----------
if command -v frpc &> /dev/null; then
  info "frpc 已安装，跳过下载"
else
  # 确定架构
  case "$ARCH" in
    x86_64)  FRP_ARCH="amd64" ;;
    aarch64) FRP_ARCH="arm64" ;;
    *)
      error "不支持的架构: $ARCH"
      exit 1
      ;;
  esac

  info "下载 frp ${FRP_VERSION} (${FRP_ARCH})..."
  cd /tmp
  wget -q "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz" -O frp.tar.gz
  tar xzf frp.tar.gz
  sudo cp "frp_${FRP_VERSION}_linux_${FRP_ARCH}/frpc" /usr/local/bin/
  sudo chmod +x /usr/local/bin/frpc
  rm -rf frp.tar.gz "frp_${FRP_VERSION}_linux_${FRP_ARCH}"
  info "frpc 安装完成: $(frpc --version 2>/dev/null || echo 'installed')"
fi

# ---------- 3. 安装配置文件 ----------
FRPC_DIR="/etc/frp"
sudo mkdir -p "$FRPC_DIR"
sudo cp "$CONFIG_FILE" "$FRPC_DIR/frpc.toml"
info "配置文件已安装到 $FRPC_DIR/frpc.toml"

# ---------- 4. 安装 systemd 服务 ----------
info "安装 frpc systemd 服务..."
cat > /tmp/frpc.service << 'EOF'
[Unit]
Description=frp Client Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frpc -c /etc/frp/frpc.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo cp /tmp/frpc.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable frpc
info "frpc 服务已安装并设为开机自启"

# ---------- 5. 启动 ----------
info "启动 frpc 服务..."
sudo systemctl restart frpc
sleep 2

if sudo systemctl is-active --quiet frpc; then
  info "frpc 启动成功！"
  echo ""
  echo "  查看连接状态：sudo systemctl status frpc"
  echo "  查看详细日志：sudo journalctl -u frpc -f"
  echo ""
  
  # 提取外网端口信息
  REMOTE_PORT=$(grep 'remotePort' "$CONFIG_FILE" | head -1 | awk -F'=' '{print $2}' | tr -d ' ')
  SERVER_ADDR=$(grep 'serverAddr' "$CONFIG_FILE" | head -1 | awk -F'"' '{print $2}')
  
  if [ -n "$REMOTE_PORT" ] && [ -n "$SERVER_ADDR" ]; then
    echo "  外网访问地址：http://${SERVER_ADDR}:${REMOTE_PORT}"
  fi
  echo ""
else
  error "frpc 启动失败，查看日志："
  sudo journalctl -u frpc -n 20 --no-pager
  exit 1
fi
