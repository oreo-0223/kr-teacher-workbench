/* ============================================================
   api.js · 前端数据层（SQLite 后端客户端）
   - 替换原 db.js (IndexedDB)，接口完全兼容
   - 所有操作通过 HTTP API 调用后端 SQLite 数据库
   - 会话 token 保存在 localStorage，请求头自动携带
   - 多设备访问同一服务器即共享数据，无需额外同步
   ============================================================ */
(function (global) {
  'use strict';

  const SESSION_KEY = 'kr_session';
  let sessionToken = null;
  let apiBase = ''; // 同源默认，开发时可手动设置

  /* ---------- 会话管理 ---------- */
  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s && s.token) sessionToken = s.token;
    } catch (_) {}
  }
  function saveSession(token) {
    sessionToken = token;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token })); } catch (_) {}
  }
  function clearSession() {
    sessionToken = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  /* ---------- HTTP 请求 ---------- */
  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
    const res = await fetch(apiBase + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      clearSession();
      // 通知前端：会话已失效，需回到登录页
      try { global.dispatchEvent(new Event('kr:session-expired')); } catch (_) {}
      throw new Error('未登录或会话已过期');
    }
    if (!res.ok) {
      let msg = '请求失败（' + res.status + '）';
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  /* ---------- 初始化 ---------- */
  async function open() {
    loadSession();
  }

  /* ---------- 数据读取 ---------- */
  async function getAll(store) {
    return request('GET', `/api/data/${store}`);
  }

  async function get(store, id) {
    return request('GET', `/api/data/${store}/${id}`);
  }

  /* ---------- 受保护操作（自动日志） ---------- */
  async function op(store, action, payload = {}) {
    return request('POST', `/api/data/${store}`, {
      action,
      id: payload.id,
      data: payload.data,
      note: payload.note || ''
    });
  }

  /* ---------- 直接写/删（不走日志） ---------- */
  async function putRaw(store, obj) {
    const res = await request('PUT', `/api/data/${store}`, obj);
    return res.id;
  }
  async function delRaw(store, id) {
    return request('DELETE', `/api/data/${store}/${id}`);
  }

  /* ---------- 操作日志 ---------- */
  async function appendLog(entry) {
    return request('POST', '/api/data/opLog', { action: 'create', data: entry });
  }
  async function rollback(logId) {
    return request('POST', `/api/opLog/rollback/${logId}`);
  }

  /* ---------- meta ---------- */
  async function getMeta() {
    return request('GET', '/api/meta');
  }
  async function setMeta(patch) {
    return request('PUT', '/api/meta', patch);
  }

  /* ---------- 班级（承载于 meta.classes） ---------- */
  // 确保班级存在（导入自动建班用）：不存在则自动创建，同名不重复
  async function ensureClass(name, subject) {
    return request('POST', '/api/classes/ensure', { name, subject: subject || '' });
  }
  // 全量归类：按现有学生的班级字段批量补齐缺失班级
  async function reconcileClasses() {
    return request('POST', '/api/classes/reconcile', {});
  }

  /* ---------- 账号管理 ---------- */
  async function getAccounts() {
    return request('GET', '/api/accounts');
  }
  async function addAccount({ username, password, role, displayName, bindingClass }) {
    const res = await request('POST', '/api/accounts', { username, password, role, displayName, bindingClass });
    return res.account;
  }
  async function verifyAccount(username, password) {
    try {
      const res = await request('POST', '/api/auth/login', { username, password });
      if (res.token) { saveSession(res.token); return res.account; }
      return null;
    } catch (e) {
      return null;
    }
  }
  async function updateAccount(id, patch) {
    const res = await request('PUT', `/api/accounts/${id}`, patch);
    return res.account;
  }
  async function deleteAccount(id) {
    return request('DELETE', `/api/accounts/${id}`);
  }

  /* ---------- 导出 / 导入 ---------- */
  async function exportAll() {
    return request('GET', '/api/export');
  }
  async function importAll(data) {
    return request('POST', '/api/import', data);
  }

  /* ---------- 首次设置 ---------- */
  async function setup({ username, password, teacher, semester, classes }) {
    const res = await request('POST', '/api/auth/setup', { username, password, teacher, semester, classes });
    if (res.token) { saveSession(res.token); return res.account; }
    return null;
  }
  async function checkSetup() {
    return request('GET', '/api/auth/check');
  }
  // 用本地保存的令牌获取当前登录账号，用于刷新后自动恢复会话
  async function me() {
    const res = await request('GET', '/api/auth/me');
    return res.account || null;
  }
  async function logout() {
    try { await request('POST', '/api/auth/logout'); } catch (_) {}
    clearSession();
  }

  /* ---------- 兼容性接口（no-op） ---------- */
  function onChange() {}      // 不再需要变更通知
  function setOnChange() {}   // 同步已由服务器处理
  function migrateV1() {}     // 服务端自动迁移

  /* ---------- 工具函数 ---------- */
  function hashPwd(pwd) {
    // 兼容旧调用：返回原始值，实际哈希在服务端完成
    return pwd;
  }
  function actionText(a) {
    return { create: '新增', update: '修改', delete: '删除', rollback: '回滚' }[a] || a;
  }
  function storeLabel(s) {
    return {
      meta: '设置', students: '花名册', schedule: '课程表',
      attendance: '考勤', discipline: '纪律', homeworkAssign: '作业布置',
      homeworkCollect: '作业收缴', homeworkWorks: '学生作业', teachingRecords: '教学记录',
      abnormalLog: '异常登记', grades: '成绩', opLog: '操作日志'
    }[s] || s;
  }

  /* ---------- 暴露（与旧 db.js 接口完全兼容） ---------- */
  global.DB = {
    // 初始化
    open, migrateV1,
    // 会话
    setup, checkSetup, logout, clearSession,
    // 数据读取
    getAll, get,
    // 受保护操作
    op, rollback, appendLog,
    // 直接写/删
    putRaw, delRaw,
    // meta
    getMeta, setMeta,
    // 班级（承载于 meta.classes）
    ensureClass, reconcileClasses,
    // 账号
    getAccounts, addAccount, verifyAccount, updateAccount, deleteAccount, me,
    // 导出/导入
    exportAll, importAll,
    // 兼容
    applySync: importAll,  // applySync 语义上等同 importAll
    SYNC_STORES: [],
    onChange, setOnChange,
    // 工具
    hashPwd, actionText, storeLabel
  };

})(window);
