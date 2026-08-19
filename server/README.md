# 科任教师工作台 · 后端服务（server）

本目录是「科任教师工作台」的**单进程后端服务**：同时提供前端静态文件与数据 API，
使用 Node.js 22 内置的 `node:sqlite`（SQLite）做持久化，**零外部依赖，无需 npm install**。

## 启动（零依赖，仅需 Node.js v22+）

```bash
cd server

# 方式一：Windows 直接双击 start.bat
# 方式二：手动启动（前台运行，用于调试）
node --disable-warning=ExperimentalWarning server.js
```

默认监听 `http://localhost:3000`。可用环境变量改端口 / 数据库路径：

```bash
PORT=8080 DB_PATH=/path/to/teacher_data.db node --disable-warning=ExperimentalWarning server.js
```

> 说明：Node.js v22.13+ 与 v24 中 `node:sqlite` 已无需 `--experimental-sqlite` 参数，
> 启动脚本中的 `--disable-warning=ExperimentalWarning` 仅用于抑制实验性特性提示，可放心使用。

## 目录结构

| 文件 | 作用 |
|------|------|
| `server.js` | HTTP 入口：静态文件服务 + API 分发 + 端口监听 |
| `api.js` | API 路由层：认证、数据 CRUD、账号管理、操作日志、导出/导入 |
| `database.js` | SQLite 数据层（schema + 事务 CRUD + 口令哈希 + 会话 + 回滚） |
| `package.json` | 项目配置（零依赖，main = server.js） |
| `start.sh` / `start.bat` | 手动启动（前台） |
| `stop.sh` / `stop.bat` | 停止服务 |
| `install.sh` / `install.bat` | 环境检测（检查 Node.js 版本） |
| `kr-teacher.service` | systemd 服务配置模板（deploy.sh 会自动生成正确路径版本） |
| `frpc.toml` / `frp-setup.sh` | frp 客户端（内网穿透，笔记本端） |
| `frps.toml` / `frps-setup.sh` | frp 服务端（内网穿透，云服务器端） |
| `data/` | 数据库文件目录（自动创建） |

## API 接口

| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| GET | `/api/auth/check` | 是否需要初始化（返回账号列表 + meta） | 否 |
| POST | `/api/auth/setup` | 首次设置（创建管理员 + meta） | 否 |
| POST | `/api/auth/login` | 登录 | 否 |
| POST | `/api/auth/logout` | 登出 | 否 |
| GET | `/api/auth/me` | 当前登录用户信息 | 是 |
| GET/PUT | `/api/meta` | 读取 / 更新配置 | 是 |
| GET/POST | `/api/accounts` | 账号列表 / 新增账号 | 是 |
| PUT/DELETE | `/api/accounts/:id` | 修改 / 删除账号 | 是 |
| GET/POST/PUT/DELETE | `/api/data/:store` | 数据 CRUD（op / raw） | 是 |
| GET | `/api/opLog` | 操作日志 | 是 |
| POST | `/api/opLog/rollback/:id` | 回滚某条操作 | 是 |
| GET | `/api/export` | 导出全部数据为 JSON | 是 |
| POST | `/api/import` | 导入备份数据 | 是 |

> 受保护接口未携带有效 Token 时返回 `401 未登录或会话已过期`。

## 数据存储说明

- 数据库文件：`server/data/teacher_data.db`（SQLite 单文件，**WAL 模式**）。
- 采用「文档式」存储设计：`id + data(JSON) + 班级索引列`，新增数据类型只需在
  `database.js` 的 `STORE_TABLE` / `SCHEMA` / `CLASS_TABLES` 中登记即可。
- 口令使用 `crypto.scrypt` 哈希存储（自描述格式），登录令牌有效期 2 小时。

## 数据备份（重要）

数据库处于 **WAL 模式**，写入会先进入 `teacher_data.db-wal` 再定期回写主库。
**仅复制 `teacher_data.db` 会丢失 WAL 中未回写的数据**。正确做法二选一：

1. 停服后**整目录复制** `server/data/`（包含 `-wal` / `-shm` 文件）；或
2. 停服后执行一次 WAL checkpoint，使数据落回主库、再复制单文件：
   ```bash
   # 使用 node:sqlite 触发 checkpoint
   node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/teacher_data.db');d.exec('PRAGMA wal_checkpoint(TRUNCATE)');console.log('checkpoint done');"
   ```

应用内也提供「设置 → 数据备份与恢复 → 导出 JSON」功能，导出的 JSON 可独立于数据库文件保存。
