#!/bin/bash
# ============================================================
# frps-setup.sh · frp 服务端安装脚本（在云服务器上运行）
# 
# 用途：在带公网 IP 的云服务器上安装 frp 服务端
# 用法：
#   chmod +x frps-setup.sh
#   ./frps-setup.sh
#
# 安装后：
#   外网访问 http://云服务器IP:8080 即可穿透到笔记本的 3000 端口
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
FRPS_PORT=7000
TOKEN=$(head -c 16 /dev/urandom | xxd -p)
BIND_PORT=8080

echo ""
echo "  === frp 服务端安装（云服务器）==="
echo ""

# 必须以 root 运行
if [ "$EUID" -ne 0 ]; then
  error "请以 root 身份运行：sudo ./frps-setup.sh"
  exit 1
fi

# ---------- 1. 下载 frp ----------
if command -v frps &> /dev/null; then
  info "frps 已安装，跳过下载"
else
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
  cp "frp_${FRP_VERSION}_linux_${FRP_ARCH}/frps" /usr/local/bin/
  chmod +x /usr/local/bin/frps
  rm -rf frp.tar.gz "frp_${FRP_VERSION}_linux_${FRP_ARCH}"
  info "frps 安装完成"
fi

# ---------- 2. 生成配置 ----------
mkdir -p /etc/frp
cat > /etc/frp/frps.toml << EOF
# frp 服务端配置
bindPort = ${FRPS_PORT}
auth.token = "${TOKEN}"

# 可选：dashboard 管理面板
webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "$(head -c 8 /dev/urandom | xxd -p)"
EOF

info "配置文件已生成：/etc/frp/frps.toml"
info "认证密钥：$TOKEN"

# ---------- 3. 安装 systemd 服务 ----------
cat > /etc/systemd/system/frps.service << 'EOF'
[Unit]
Description=frp Server Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable frps
info "frps 服务已安装并设为开机自启"

# ---------- 4. 启动 ----------
systemctl restart frps
sleep 2

if systemctl is-active --quiet frps; then
  info "frps 启动成功！"
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║     frp 服务端部署完成                      ║"
  echo "  ╠══════════════════════════════════════════════╣"
  
  PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "你的公网IP")
  DASHBOARD_PWD=$(grep 'webServer.password' /etc/frp/frps.toml | awk -F'"' '{print $2}')
  
  echo "  ║  frp 端口：    ${FRPS_PORT}                     ║"
  echo "  ║  外网访问端口：${BIND_PORT}（需要在 frpc 中配置）  ║"
  echo "  ║  管理面板：    http://${PUBLIC_IP}:7500"
  echo "  ║  面板账号：    admin"
  echo "  ║  面板密码：    ${DASHBOARD_PWD}"
  echo "  ║                                              ║"
  echo "  ║  ⚠️  请保存以下信息（笔记本 frpc 配置需要）：  ║"
  echo "  ║  服务端地址：  ${PUBLIC_IP}"
  echo "  ║  认证密钥：    ${TOKEN}"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""
  warn "请在云服务器安全组中放行端口：${FRPS_PORT}, ${BIND_PORT}, 7500"
  echo ""
  echo "  下一步：在笔记本上运行 frp-setup.sh，填入以上信息"
  echo ""
else
  error "frps 启动失败，查看日志："
  journalctl -u frps -n 20 --no-pager
  exit 1
fi
