# 科任教师工作台（kr-teacher-workbench）

> 面向中职学校科任教师的轻量级全栈工作台：花名册 / 班级、考勤、纪律、作业、成绩分析、课程表、操作日志一体化，单进程即可运行，**零外部依赖、零 npm install**。

## 项目简介

「科任教师工作台」是一套为中等职业学校科任教师设计的日常管理工具，覆盖任教班级的学生管理、课堂考勤、纪律记录、作业布置与收缴、成绩分析、课程表排课等核心场景。系统采用「前端原生 JS + Node.js 内置 SQLite」的极简技术栈，无需任何第三方包，拷贝即用、部署极简，非常适合校园内网 / 单机 / 轻量云服务器场景。

- **前端**：原生 HTML / CSS / JavaScript，无框架、无构建步骤，浏览器直接运行。
- **后端**：Node.js v22 内置 `node:sqlite`，单进程同时托管静态页面与数据 API。
- **数据**：SQLite 单文件，WAL 模式，文档式存储，支持导出 / 导入备份与操作回滚。
- **认证**：服务端 Session Token（scrypt 口令哈希，令牌 2 小时有效期）。

## 功能特性

| 模块 | 说明 |
|------|------|
| 🏠 工作台 | 今日待处理聚合（今日课程 / 截止作业 / 考勤 / 异常提醒）+ 六大板块入口 |
| 📅 课程表 | 按学校作息排课，支持合并视图、时段可编辑、跨设备同步 |
| 👦 花名册 / 班级管理 | 多班级卡片管理，学生增删改查，支持 CSV 批量导入 / 导出 |
| 📊 成绩分析 | 考试录入、均分 / 分段 / 排名统计，均分趋势折线图，CSV 导出 |
| 📜 操作日志 | 追加式日志，只读不可删，任意写操作可一键回滚 |
| 🚪 教室展示端 | 绑定班级的只读展示 + 课堂点名 / 作业展示 |
| 🔐 账号管理 | 办公室（管理员）/ 教室展示两种角色，多账号、多班级 |

## 技术架构

```
浏览器 (原生 HTML/CSS/JS)
   │  HTTP + JSON (Bearer Token 鉴权)
   ▼
Node.js v22 单进程 (server/server.js)
   ├── 静态文件服务 (前端页面)
   ├── API 路由层 (server/api.js)
   └── SQLite 数据层 (server/database.js, node:sqlite)
            └── server/data/teacher_data.db (WAL)
```

- 前端模块：`api`(数据层) · `app`(主控制器) · `workbench` · `schedule` · `roster` · `grades` · `logview` · `classroom` · `xlsx-read`(零依赖 Excel 读取)
- 后端模块：`server.js`(HTTP 入口) · `api.js`(路由) · `database.js`(数据层)
- 部署：一键脚本 `deploy.sh` / `deploy.bat`，systemd 开机自启，frp 内网穿透模板

> 完整部署、配置与 API 说明见下方「部署指南」。

---

# 科任教师工作台 — 部署指南

## 系统要求

- **操作系统**：Ubuntu Server 22.04 LTS（推荐） / Debian 12+ / Windows 10+
- **Node.js v22+**（需自行安装，v22 内置 SQLite 支持）
- 无需数据库软件，SQLite 已内置
- **零外部依赖**，无需 npm install

---

## Ubuntu Server 部署（推荐）

### 第一步：安装 Ubuntu Server

1. 下载 [Ubuntu Server 22.04 LTS](https://ubuntu.com/download/server)
2. 用 [Rufus](https://rufus.ie/) 或 balenaEtcher 制作 U 盘启动盘
3. 笔记本从 U 盘启动，按提示安装
4. 安装时勾选 **SSH Server**（远程管理必需）
5. 安装完成后不需要接显示器，通过 SSH 远程管理

```bash
# 安装完成后通过另一台电脑 SSH 连接笔记本
ssh username@笔记本局域网IP
```

### 第二步：安装 Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node --version   # 确认输出 v22.x.x
```

### 第三步：部署项目

```bash
# 将项目文件夹传到笔记本（用 scp 或 U 盘）
# 假设放在 ~/kr-teacher/

cd ~/kr-teacher
chmod +x deploy.sh
./deploy.sh
```

`deploy.sh` 会自动完成：
- 检测 Node.js 版本
- 安装 systemd 服务（开机自启 + 崩溃自动重启）
- 启动服务

### 第四步：访问

```bash
# 本机
http://localhost:3000

# 局域网其他设备（手机/平板/电脑）
http://笔记本IP:3000
```

### 常用管理命令

```bash
sudo systemctl status kr-teacher     # 查看状态
sudo systemctl restart kr-teacher    # 重启服务
sudo systemctl stop kr-teacher       # 停止服务
sudo journalctl -u kr-teacher -f     # 实时查看日志
```

---

## 外网访问（frp 内网穿透）

没有公网 IP 时，通过 frp + 云服务器实现外网访问。

### 架构

```
手机/电脑 → 云服务器(公网IP:8080) ← frp隧道 ← 笔记本(localhost:3000)
```

### 1. 云服务器端（frps）

在云服务器（阿里云/腾讯云轻量服务器，¥30~60/月）上运行：

```bash
chmod +x frps-setup.sh
sudo ./frps-setup.sh
```

脚本会自动：
- 下载安装 frps
- 生成随机认证密钥
- 配置 systemd 开机自启
- 输出连接信息（**务必保存**）

> 云服务器安全组需放行端口：7000（frp通信）、8080（外网访问）、7500（管理面板）

### 2. 笔记本端（frpc）

编辑 `server/frpc.toml`，填入云服务器信息：

```toml
serverAddr = "云服务器公网IP"
serverPort = 7000
auth.token = "云脚本输出的密钥"

[[proxies]]
name = "kr-teacher-web"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3000
remotePort = 8080
```

然后运行：

```bash
cd ~/kr-teacher/server
chmod +x frp-setup.sh
./frp-setup.sh
```

### 3. 外网访问

```
http://云服务器公网IP:8080
```

> frpc 也已配置为 systemd 服务，开机自动连接。

---

## Windows 部署（备选）

如果选择保持 Windows 系统：

1. 安装 [Node.js v22+](https://nodejs.org/)
2. 双击 `deploy.bat`
3. 浏览器打开 `http://localhost:3000`

**Windows 做服务器的注意事项：**
- 设置永不休眠：`powercfg /change standby-timeout-ac 0`
- 设置合盖不关机：控制面板 → 电源选项 → 选择关闭盖子的功能 → 不采取任何操作
- 关闭 Windows Update 自动重启
- 开机自启：将 `start.bat` 快捷方式放入启动目录（`Win+R` → `shell:startup`）

---

## 脚本说明

### Linux 脚本

| 脚本 | 功能 |
|------|------|
| `deploy.sh` | 一键部署（检测环境 → 安装 systemd 服务 → 启动） |
| `server/install.sh` | 环境检测（检测/安装 Node.js 22） |
| `server/start.sh` | 手动启动（前台运行，用于调试） |
| `server/stop.sh` | 停止服务 |
| `server/frps-setup.sh` | 云服务器安装 frp 服务端 |
| `server/frp-setup.sh` | 笔记本安装 frp 客户端 |
| `server/kr-teacher.service` | systemd 服务配置文件 |

### Windows 脚本

| 脚本 | 功能 |
|------|------|
| `deploy.bat` | 一键部署（环境检测 + 启动服务） |
| `server\install.bat` | 环境检测 |
| `server\start.bat` | 启动服务 |
| `server\stop.bat` | 停止服务 |

---

## 配置

### 修改端口

编辑 systemd 服务文件：
```bash
sudo systemctl edit kr-teacher
```
添加：
```ini
[Service]
Environment=PORT=8080
```
然后 `sudo systemctl restart kr-teacher`

### 数据库位置

SQLite 数据库文件自动创建在：`server/data/teacher_data.db`
也可通过环境变量 `DB_PATH` 自定义路径。

### 数据备份

- **应用内备份**：设置 → 数据备份与恢复 → 导出 JSON
- **文件备份**：直接复制 `server/data/teacher_data.db`

---

## 架构说明

```
项目结构:
├── index.html              前端入口
├── css/style.css           样式
├── js/
│   ├── api.js              前端数据层（HTTP API 客户端）
│   ├── app.js              主控制器
│   ├── workbench.js        工作台（六大板块）
│   ├── schedule.js         课程表
│   ├── roster.js           花名册
│   ├── grades.js           成绩分析
│   ├── logview.js          操作日志（只读+回滚）
│   └── classroom.js        教室端（点名+作业展示）
├── server/
│   ├── server.js           HTTP 服务器（静态文件 + API）
│   ├── database.js         SQLite 数据层（schema + CRUD）
│   ├── api.js              API 路由（认证 + 数据 + 日志）
│   ├── package.json        项目配置（零依赖）
│   ├── deploy.sh           Ubuntu 一键部署
│   ├── install.sh          环境检测
│   ├── start.sh            手动启动
│   ├── stop.sh             停止服务
│   ├── kr-teacher.service   systemd 服务配置
│   ├── frpc.toml           frp 客户端配置模板
│   ├── frp-setup.sh        frp 客户端安装脚本
│   ├── frps.toml           frp 服务端配置模板
│   ├── frps-setup.sh       frp 服务端安装脚本
│   └── data/               数据库文件目录（自动创建）
├── deploy.bat              Windows 一键部署
├── deploy.sh               Ubuntu 一键部署
└── README.md               本文档
```

### 技术栈
- **前端**：原生 HTML/CSS/JS（无框架依赖）
- **后端**：Node.js 内置 HTTP 模块 + node:sqlite（Node.js 22 内置 SQLite）
- **数据库**：SQLite（单文件，零配置，零外部依赖）
- **认证**：服务端 Session Token
- **内网穿透**：frp（开源，自动重连）

### API 接口
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/auth/check` | 检查是否需要初始化（返回账号列表+meta） |
| POST | `/api/auth/setup` | 首次设置 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET/PUT | `/api/meta` | 读取/更新配置 |
| GET/POST/PUT/DELETE | `/api/accounts` | 账号管理 |
| GET/POST/PUT/DELETE | `/api/data/:store` | 数据 CRUD |
| GET | `/api/opLog` | 操作日志 |
| POST | `/api/opLog/rollback/:id` | 回滚操作 |
| GET/POST | `/api/export` `/api/import` | 导出/导入 |

### 扩展接口
数据层采用文档式存储设计（`id + data(JSON) + 索引列`），新增数据类型只需：
1. 在 `database.js` 的 `STORE_TABLE` 中添加映射
2. 如需按班级查询，将表名加入 `CLASS_TABLES`
3. 在 `SCHEMA` 中添加 `CREATE TABLE` 语句
4. 前端通过 `DB.getAll('newStore')` / `DB.op('newStore', 'create', ...)` 即可使用

---

## 常见问题

### Q: 启动报错 "node:sqlite is not available"
A: Node.js 版本过低，需升级到 v22+。运行 `node --version` 检查版本。

### Q: 启动时显示 "ExperimentalWarning: SQLite is an experimental feature"
A: 这是正常提示，不影响使用。启动脚本已添加 `--disable-warning=ExperimentalWarning` 参数自动抑制。

### Q: 端口被占用
A: `sudo ./server/stop.sh` 停止旧进程，或修改端口。

### Q: 局域网其他设备访问不了
A: 检查 Ubuntu 防火墙：`sudo ufw allow 3000`

### Q: frp 连接不上
A: 检查：
1. 云服务器安全组是否放行 7000 和 8080 端口
2. frpc.toml 中的 IP、token 是否与云服务器一致
3. `sudo journalctl -u frpc -f` 查看连接日志

### Q: 如何设为开机自启
A: `deploy.sh` 已自动配置 systemd 开机自启。手动配置：`sudo systemctl enable kr-teacher`

### Q: 换了电脑怎么迁移
A: 复制整个项目文件夹到新电脑，运行 `./deploy.sh` 即可。数据库在 `server/data/teacher_data.db`。
