/* ============================================================
   server.js · HTTP 服务器入口
   - 提供静态文件服务（前端页面）
   - 分发 API 请求到 api.js
   - 单进程同时服务前端 + API，部署只需启动一个程序
   - 默认端口 3000，可通过环境变量 PORT 修改
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('./api');
const DB = require('./database');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

// 初始化数据库 + 迁移
DB.migrate();

/* ---------- MIME 类型 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8'
};

/* ---------- 静态文件服务 ---------- */
function serveStatic(res, pathname) {
  // 开发模式：不缓存任何静态资源，确保改动即时生效
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  let filePath = path.join(ROOT, decodeURIComponent(pathname));

  // 安全：防止目录遍历
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // 默认页面
  if (pathname === '/' || pathname === '') {
    filePath = path.join(ROOT, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA 回退：找不到文件时返回 index.html
        fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
          if (e2) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>404 Not Found</h1><p>请确认前端文件存在。</p>');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(d2);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

/* ---------- HTTP 服务器 ---------- */
const server = http.createServer(async (req, res) => {
  // CORS 预检
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // API 路由
  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  // 静态文件
  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║     📚 科任教师工作台 — 服务已启动           ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  访问地址：http://localhost:${PORT}          ║`);
  console.log(`  ║  局域网访问：http://<本机IP>:${PORT}         ║`);
  console.log('  ║  按 Ctrl+C 停止服务                          ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  数据库文件：${DB.dbPath || path.join(__dirname, 'data', 'teacher_data.db')}`);
  console.log('');
});
