/* ============================================================
   api.js · API 路由层
   - 认证：setup / login / logout / check
   - 数据 CRUD：op / raw / getAll / get
   - meta 管理
   - 账号管理
   - 操作日志 + 回滚
   - 导出 / 导入
   - 所有写操作在 database.js 的事务中自动记录 opLog
   ============================================================ */
'use strict';

const DB = require('./database');

/* ---------- 工具函数 ---------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 15 * 1024 * 1024; // 15MB（支持图片 base64）
    req.on('data', c => {
      size += c.length;
      if (size > MAX) { reject(new Error('请求体过大（>15MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** 从请求头提取 Bearer token */
function getToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return '';
}

/** 认证中间件：返回 session 或 null */
function authReq(req) {
  const token = getToken(req);
  return DB.getSession(token);
}

/** 需要登录才能访问 */
function requireAuth(req, res) {
  const session = authReq(req);
  if (!session) {
    sendJson(res, 401, { message: '未登录或会话已过期' });
    return null;
  }
  return session;
}

/* ---------- 主路由 ---------- */
async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  try {
    /* ===== 认证 ===== */

    // 检查是否需要初始化（同时返回公开数据供前端渲染登录页）
    if (pathname === '/api/auth/check' && method === 'GET') {
      const accounts = DB.getAccounts();
      sendJson(res, 200, {
        needsSetup: accounts.length === 0,
        accounts,
        meta: DB.getMeta() || {}
      });
      return;
    }

    // 首次设置：创建管理员账号 + meta
    if (pathname === '/api/auth/setup' && method === 'POST') {
      const body = await readBody(req);
      const { username, password, teacher, semester, classes } = body;
      if (!username || !password) { sendJson(res, 400, { message: '账号和口令不能为空' }); return; }
      const existing = DB.getAccounts();
      if (existing.length > 0) { sendJson(res, 409, { message: '系统已初始化，请直接登录' }); return; }

      DB.setMeta({ teacher: teacher || '', semester: semester || '', classes: classes || [] });
      const acc = DB.addAccount({ username, password, role: 'office', displayName: teacher || '' });
      const token = DB.createSession(acc.id, acc);
      sendJson(res, 200, { token, account: acc });
      return;
    }

    // 登录
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const { username, password } = body;
      const acc = DB.verifyAccount(username, password);
      if (!acc) { sendJson(res, 401, { message: '账号或口令不正确' }); return; }
      const token = DB.createSession(acc.id, acc);
      sendJson(res, 200, { token, account: acc });
      return;
    }

    // 登出
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const token = getToken(req);
      if (token) DB.deleteSession(token);
      sendJson(res, 200, { ok: true });
      return;
    }

    /* ===== 以下接口需要登录 ===== */
    const session = requireAuth(req, res);
    if (!session) return;

    /* ===== 当前登录用户（刷新后恢复会话用） ===== */
    if (pathname === '/api/auth/me' && method === 'GET') {
      const account = DB.getAccountById(session.accountId);
      if (!account) { sendJson(res, 401, { message: '账号不存在或已被删除' }); return; }
      sendJson(res, 200, { account });
      return;
    }

    /* ===== meta ===== */
    if (pathname === '/api/meta' && method === 'GET') {
      sendJson(res, 200, DB.getMeta() || {});
      return;
    }
    if (pathname === '/api/meta' && method === 'PUT') {
      const body = await readBody(req);
      const next = DB.setMeta(body);
      sendJson(res, 200, next);
      return;
    }

    /* ===== 班级（承载于 meta.classes） ===== */
    // 确保班级存在（导入自动建班用）：body { name, subject? }
    if (pathname === '/api/classes/ensure' && method === 'POST') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      if (!name) { sendJson(res, 400, { message: '班级名称不能为空' }); return; }
      const r = DB.ensureClass(name, (body.subject || '').trim());
      sendJson(res, 200, r);
      return;
    }
    // 全量归类：按现有学生 className 批量确保班级存在
    if (pathname === '/api/classes/reconcile' && method === 'POST') {
      const r = DB.reconcileClassesFromStudents();
      sendJson(res, 200, r);
      return;
    }

    /* ===== 账号管理 ===== */
    if (pathname === '/api/accounts' && method === 'GET') {
      sendJson(res, 200, DB.getAccounts());
      return;
    }
    if (pathname === '/api/accounts' && method === 'POST') {
      const body = await readBody(req);
      try {
        const acc = DB.addAccount(body);
        sendJson(res, 200, { account: acc });
      } catch (e) { sendJson(res, 400, { message: e.message }); }
      return;
    }
    const accMatch = pathname.match(/^\/api\/accounts\/(\d+)$/);
    if (accMatch) {
      const id = parseInt(accMatch[1]);
      if (method === 'PUT') {
        const body = await readBody(req);
        const acc = DB.updateAccount(id, body);
        sendJson(res, 200, { account: acc });
        return;
      }
      if (method === 'DELETE') {
        DB.deleteAccount(id);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    /* ===== 数据 CRUD ===== */
    const dataMatch = pathname.match(/^\/api\/data\/([^/]+)$/);
    if (dataMatch) {
      const store = dataMatch[1];
      if (!DB.STORE_TABLE[store]) { sendJson(res, 404, { message: '未知存储: ' + store }); return; }

      if (method === 'GET') {
        sendJson(res, 200, DB.getAll(store));
        return;
      }
      if (method === 'POST') {
        // op 操作：{ action, id?, data?, note? }
        const body = await readBody(req);
        const result = DB.op(store, body.action || 'create', {
          id: body.id,
          data: body.data,
          note: body.note
        });
        sendJson(res, 200, result);
        return;
      }
      if (method === 'PUT') {
        // raw 写入（不走日志）
        const body = await readBody(req);
        const id = DB.putRaw(store, body);
        sendJson(res, 200, { id });
        return;
      }
    }

    // 按 id 操作
    const itemMatch = pathname.match(/^\/api\/data\/([^/]+)\/([^/]+)$/);
    if (itemMatch) {
      const store = itemMatch[1];
      const idStr = itemMatch[2];
      if (!DB.STORE_TABLE[store]) { sendJson(res, 404, { message: '未知存储: ' + store }); return; }

      if (idStr === 'raw') {
        // PUT /api/data/:store/raw 已在上面处理
        sendJson(res, 404, { message: '接口不存在' });
        return;
      }

      const id = parseInt(idStr);
      if (isNaN(id)) { sendJson(res, 400, { message: '无效的 id' }); return; }

      if (method === 'GET') {
        sendJson(res, 200, DB.get(store, id));
        return;
      }
      if (method === 'DELETE') {
        // raw 删除（不走日志）
        DB.delRaw(store, id);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    /* ===== 操作日志 ===== */
    if (pathname === '/api/opLog' && method === 'GET') {
      sendJson(res, 200, DB.getAll('opLog'));
      return;
    }
    const rbMatch = pathname.match(/^\/api\/opLog\/rollback\/(\d+)$/);
    if (rbMatch && method === 'POST') {
      const logId = parseInt(rbMatch[1]);
      DB.rollback(logId);
      sendJson(res, 200, { ok: true });
      return;
    }

    /* ===== 导出 / 导入 ===== */
    if (pathname === '/api/export' && method === 'GET') {
      sendJson(res, 200, DB.exportAll());
      return;
    }
    if (pathname === '/api/import' && method === 'POST') {
      const body = await readBody(req);
      DB.importAll(body);
      sendJson(res, 200, { ok: true });
      return;
    }

    /* ===== 404 ===== */
    sendJson(res, 404, { message: '接口不存在: ' + pathname });
  } catch (e) {
    sendJson(res, 500, { message: '服务端错误：' + e.message });
  }
}

module.exports = { handleApi };
