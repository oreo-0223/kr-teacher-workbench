/* ============================================================
   database.js · SQLite 数据库层
   - 使用 Node.js 22 内置 node:sqlite 模块（零外部依赖）
   - 每个 store 对应一张表：id + data(JSON) + 提取的索引列
   - 提供 CRUD、opLog、口令哈希、会话管理等基础能力
   - 所有写操作支持事务包裹，保证原子性
   ============================================================ */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/* ---------- 路径与连接 ---------- */
const DATA_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'teacher_data.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ---------- 事务辅助（node:sqlite 无 db.transaction()） ---------- */
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }
  };
}

/* ---------- Schema 定义 ---------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  id   INTEGER PRIMARY KEY DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS accounts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pwd_hash TEXT NOT NULL DEFAULT '',
  data     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS students (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);

CREATE TABLE IF NOT EXISTS schedule (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_schedule_class ON schedule(class_name);

CREATE TABLE IF NOT EXISTS attendance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance(class_name);

CREATE TABLE IF NOT EXISTS discipline (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_discipline_class ON discipline(class_name);

CREATE TABLE IF NOT EXISTS homework_assign (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_hw_assign_class ON homework_assign(class_name);

CREATE TABLE IF NOT EXISTS homework_collect (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_hw_collect_class ON homework_collect(class_name);

CREATE TABLE IF NOT EXISTS homework_works (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_hw_works_class ON homework_works(class_name);

CREATE TABLE IF NOT EXISTS teaching_records (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_teaching_class ON teaching_records(class_name);

CREATE TABLE IF NOT EXISTS abnormal_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_abnormal_class ON abnormal_log(class_name);

CREATE TABLE IF NOT EXISTS grades (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_grades_class ON grades(class_name);

CREATE TABLE IF NOT EXISTS op_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL DEFAULT 0,
  store TEXT NOT NULL DEFAULT '',
  data  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_oplog_ts ON op_log(ts);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  expire_at  INTEGER
);
`;

db.exec(SCHEMA);

// 兼容旧库：sessions 表增加过期时间字段（永久有效 → 2 小时有效期）
try { db.exec('ALTER TABLE sessions ADD COLUMN expire_at INTEGER'); } catch (_) { /* 字段已存在则忽略 */ }
// 旧会话（无过期时间）统一补为"从现在起 2 小时"，避免已登录会话立即失效，且不再永久有效
db.prepare('UPDATE sessions SET expire_at = ? WHERE expire_at IS NULL').run(Date.now() + 2 * 60 * 60 * 1000);

/* ---------- Store ↔ Table 映射 ---------- */
const STORE_TABLE = {
  meta:            'meta',
  accounts:        'accounts',
  students:        'students',
  schedule:        'schedule',
  attendance:      'attendance',
  discipline:      'discipline',
  homeworkAssign:  'homework_assign',
  homeworkCollect: 'homework_collect',
  homeworkWorks:   'homework_works',
  teachingRecords: 'teaching_records',
  abnormalLog:     'abnormal_log',
  grades:          'grades',
  opLog:           'op_log'
};
const TABLE_STORE = Object.fromEntries(
  Object.entries(STORE_TABLE).map(([s, t]) => [t, s])
);

/* 需要提取 class_name 索引列的表 */
const CLASS_TABLES = new Set([
  'students', 'schedule', 'attendance', 'discipline',
  'homework_assign', 'homework_collect', 'homework_works',
  'teaching_records', 'abnormal_log', 'grades'
]);

/* ---------- 通用 CRUD ---------- */

/** 全表读取，返回 [{id, ...data}, ...] */
function getAll(store) {
  const table = STORE_TABLE[store];
  if (!table) throw new Error('未知存储: ' + store);
  const rows = db.prepare(`SELECT id, data FROM ${table}`).all();
  return rows.map(r => {
    const obj = JSON.parse(r.data);
    obj.id = r.id;
    return obj;
  });
}

/** 按 id 读取 */
function get(store, id) {
  const table = STORE_TABLE[store];
  if (!table) throw new Error('未知存储: ' + store);
  const row = db.prepare(`SELECT id, data FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;
  const obj = JSON.parse(row.data);
  obj.id = row.id;
  return obj;
}

/** 直接写入（不走日志），返回 id */
function putRaw(store, obj) {
  const table = STORE_TABLE[store];
  if (!table) throw new Error('未知存储: ' + store);
  const data = { ...obj };
  const id = data.id || null;
  delete data.id;
  const className = data.className || '';
  const json = JSON.stringify(data);

  if (store === 'accounts') {
    // accounts 需要提取 username 和 pwd_hash
    if (id) {
      db.prepare(`UPDATE accounts SET username = ?, pwd_hash = ?, data = ? WHERE id = ?`)
        .run(data.username || '', data.pwdHash || '', json, id);
      return id;
    } else {
      const r = db.prepare(`INSERT INTO accounts (username, pwd_hash, data) VALUES (?, ?, ?)`)
        .run(data.username || '', data.pwdHash || '', json);
      return Number(r.lastInsertRowid);
    }
  }

  if (store === 'opLog') {
    const ts = data.ts || Date.now();
    const st = data.store || '';
    if (id) {
      db.prepare(`UPDATE op_log SET ts = ?, store = ?, data = ? WHERE id = ?`).run(ts, st, json, id);
      return id;
    } else {
      const r = db.prepare(`INSERT INTO op_log (ts, store, data) VALUES (?, ?, ?)`).run(ts, st, json);
      return Number(r.lastInsertRowid);
    }
  }

  if (store === 'meta') {
    db.prepare(`INSERT OR REPLACE INTO meta (id, data) VALUES (1, ?)`).run(json);
    return 1;
  }

  // 通用表（带 class_name 索引列）
  // 使用 INSERT OR REPLACE：行存在时等价 UPDATE（编辑/更新场景）；
  // 行已被删除时（导入恢复、回滚删除操作）则重新插入，
  // 避免旧逻辑用 UPDATE 命中 0 行导致数据无法写回 / 无法恢复。
  if (id) {
    db.prepare(`INSERT OR REPLACE INTO ${table} (id, class_name, data) VALUES (?, ?, ?)`).run(id, className, json);
    return id;
  } else {
    const r = db.prepare(`INSERT INTO ${table} (class_name, data) VALUES (?, ?)`).run(className, json);
    return Number(r.lastInsertRowid);
  }
}

/** 直接删除（不走日志） */
function delRaw(store, id) {
  const table = STORE_TABLE[store];
  if (!table) throw new Error('未知存储: ' + store);
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return true;
}

/* ---------- 操作日志（追加式） ---------- */
function appendLog(entry) {
  const data = {
    ts: entry.ts || Date.now(),
    timeText: entry.timeText || new Date().toLocaleString('zh-CN', { hour12: false }),
    store: entry.store || '',
    action: entry.action || '',
    entityId: entry.entityId || 0,
    before: entry.before || null,
    after: entry.after || null,
    note: entry.note || ''
  };
  const id = putRaw('opLog', data);
  return id;
}

/**
 * op - 受保护的数据操作：在事务内执行写操作 + 自动记录日志
 * @returns { id, before, after }
 */
const op = transaction(function(store, action, payload = {}) {
  let before = null, after = null, id = payload.id;

  if (action === 'create') {
    const clean = { ...payload.data };
    delete clean.id;
    id = putRaw(store, clean);
    after = { ...clean, id };
  } else if (action === 'update') {
    before = get(store, id);
    const merged = { ...(before || {}), ...(payload.data || {}) };
    merged.id = id;
    putRaw(store, merged);
    after = { ...merged };
  } else if (action === 'delete') {
    before = get(store, id);
    if (before) delRaw(store, id);
  }

  appendLog({
    store, action, entityId: id,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: after ? JSON.parse(JSON.stringify(after)) : null,
    note: payload.note || ''
  });

  return { id, before, after };
});

/**
 * rollback - 回滚某条日志记录的数据影响
 * create → 删除该实体；update → 还原 before；delete → 重新写入 before
 */
const rollback = transaction(function(logId) {
  const log = get('opLog', logId);
  if (!log) throw new Error('日志记录不存在');
  if (log.action === 'rollback') throw new Error('回滚操作不可再次回滚');

  const store = log.store;
  let before = null;

  if (log.action === 'create') {
    before = get(store, log.entityId);
    try { delRaw(store, log.entityId); } catch (_) {}
  } else if (log.action === 'update') {
    const cur = get(store, log.entityId);
    before = cur ? JSON.parse(JSON.stringify(cur)) : null;
    if (log.before) putRaw(store, { ...log.before, id: log.entityId });
  } else if (log.action === 'delete') {
    if (log.before) putRaw(store, { ...log.before });
  }

  appendLog({
    store, action: 'rollback', entityId: log.entityId,
    before, after: log.before,
    note: `回滚操作 #${logId}（${actionText(log.action)} ${storeLabel(store)}）`
  });

  return true;
});

/* ---------- meta 辅助 ---------- */
function getMeta() {
  const row = db.prepare('SELECT data FROM meta WHERE id = 1').get();
  if (!row) return null;
  const obj = JSON.parse(row.data);
  obj.id = 1;
  return obj;
}
function setMeta(patch) {
  const cur = getMeta() || {};
  const next = { ...cur, ...patch };
  next.id = 1;
  // 如果传了 password，服务端哈希后存为 pwdHash
  if (next.password) {
    next.pwdHash = hashPassword(next.password);
    delete next.password;
  }
  db.prepare('INSERT OR REPLACE INTO meta (id, data) VALUES (1, ?)').run(JSON.stringify(next));
  return next;
}

/* ---------- 口令哈希 ----------
   升级为 scrypt（Node 内置 crypto，零外部依赖）。
   存储格式自描述： scrypt$N:r:p$<saltB64>$<hashB64>
   旧版为「固定盐的字符串弱哈希」，仅用于兼容已存在的历史账号，
   不再用于新建 / 改密；历史账号首次成功登录时会被就地升级为 scrypt。 */
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEYLEN = 64;

// 旧版弱哈希（仅兼容比对，不再用于写入）
function legacyHash(pwd) {
  let h = 0;
  const s = 'kr_salt_v1::' + (pwd || '');
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

// 生成 scrypt 哈希
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pwd || '', salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return `scrypt$${SCRYPT_OPTS.N}:${SCRYPT_OPTS.r}:${SCRYPT_OPTS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// 校验 scrypt 哈希（常数时间比较）
function verifyPassword(stored, pwd) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  try {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [N, r, p] = parts[1].split(':').map(Number);
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const actual = crypto.scryptSync(pwd || '', salt, expected.length, { N, r, p });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

// 历史账号首次成功登录时，把弱哈希就地升级为 scrypt（同时更新列与 data JSON）
function upgradeAccountHash(id, newHash, dataJson) {
  try {
    const obj = JSON.parse(dataJson);
    obj.pwdHash = newHash;
    db.prepare('UPDATE accounts SET pwd_hash = ?, data = ? WHERE id = ?').run(newHash, JSON.stringify(obj), id);
  } catch { /* 升级失败不影响本次登录 */ }
}

/* ---------- 账号管理 ---------- */
function stripPwd(a) { if (!a) return a; const { pwdHash, ...rest } = a; return rest; }
function getAccounts() {
  const rows = db.prepare('SELECT id, data FROM accounts ORDER BY id').all();
  const list = rows.map(r => {
    const obj = JSON.parse(r.data);
    obj.id = r.id;
    return stripPwd(obj);
  });
  return list.sort((a, b) =>
    ((a.role === 'office' ? 0 : 1) - (b.role === 'office' ? 0 : 1)) || (a.id - b.id)
  );
}
function addAccount({ username, password, role, displayName, bindingClass }) {
  const clean = {
    username: (username || '').trim(),
    pwdHash: hashPassword(password || ''),
    role: role === 'classroom' ? 'classroom' : 'office',
    displayName: (displayName || '').trim(),
    createdAt: Date.now()
  };
  if (clean.role === 'classroom') clean.bindingClass = bindingClass || '';
  if (!clean.username) throw new Error('账号不能为空');
  // 检查唯一性
  const exist = db.prepare('SELECT id FROM accounts WHERE username = ?').get(clean.username);
  if (exist) throw new Error('账号已存在');
  const id = putRaw('accounts', clean);
  return stripPwd({ id, ...clean });
}
function verifyAccount(username, password) {
  const row = db.prepare('SELECT id, pwd_hash, data FROM accounts WHERE username = ?')
    .get((username || '').trim());
  if (!row) return null;
  let ok = false;
  if (typeof row.pwd_hash === 'string' && row.pwd_hash.startsWith('scrypt$')) {
    ok = verifyPassword(row.pwd_hash, password || '');
  } else {
    // 历史弱哈希：兼容校验，登录成功后就地升级为 scrypt
    ok = (row.pwd_hash === legacyHash(password || ''));
    if (ok) upgradeAccountHash(row.id, hashPassword(password || ''), row.data);
  }
  if (!ok) return null;
  const obj = JSON.parse(row.data);
  obj.id = row.id;
  const { pwdHash, ...rest } = obj;
  return rest;
}
function updateAccount(id, patch) {
  const row = db.prepare('SELECT data FROM accounts WHERE id = ?').get(id);
  if (!row) throw new Error('账号不存在');
  const cur = JSON.parse(row.data);
  // 如果传了 password，哈希后存为 pwdHash
  if (patch.password) {
    patch.pwdHash = hashPassword(patch.password);
    delete patch.password;
  }
  const merged = { ...cur, ...patch };
  merged.id = id;
  putRaw('accounts', merged);
  return stripPwd(merged);
}
function deleteAccount(id) {
  delRaw('accounts', id);
  // 清理该账号的会话
  db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id);
  return true;
}

/** 按 id 读取单个账号（不含口令哈希），用于恢复会话时确认当前用户 */
function getAccountById(id) {
  const row = db.prepare('SELECT id, data FROM accounts WHERE id = ?').get(id);
  if (!row) return null;
  const obj = JSON.parse(row.data);
  obj.id = row.id;
  return stripPwd(obj);
}

/* ---------- 会话管理 ---------- */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 登录令牌有效期：2 小时（非永久）

function createSession(accountId, accountData) {
  const token = crypto.randomBytes(32).toString('hex');
  const data = JSON.stringify({
    accountId,
    username: accountData.username,
    role: accountData.role,
    displayName: accountData.displayName,
    bindingClass: accountData.bindingClass || '',
    createdAt: Date.now()
  });
  db.prepare('INSERT OR REPLACE INTO sessions (token, account_id, data, expire_at) VALUES (?, ?, ?, ?)')
    .run(token, accountId, data, Date.now() + TOKEN_TTL_MS);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT account_id, data, expire_at FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  // 令牌已过期（>2 小时）：清理并返回无效，前端据此回到登录页
  if (row.expire_at && row.expire_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { accountId: row.account_id, ...JSON.parse(row.data) };
}
function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return true;
}

/* ---------- 班级（承载于 meta.classes） ----------
   班级不是独立表，而是 meta.classes 数组里的对象 {name, subject}。
   学生通过 data.className 关联班级名。以下函数保证「按班级名幂等建班」，
   供导入自动建班、历史数据归类复用，单一数据源、避免前端多处重复实现。 */

/** 规范化班级名：去首尾空白；空值返回 '' */
function normClassName(name) {
  return (name == null ? '' : String(name)).trim();
}

/**
 * 确保某班级存在于 meta.classes（幂等，不重复创建同名班级）。
 * @param {string} name 班级名
 * @param {string} [subject] 任教科目（已存在且原无科目时可补全）
 * @returns {{existed:boolean, created:boolean, class:?{name,subject}}}
 */
function ensureClass(name, subject) {
  const nm = normClassName(name);
  if (!nm) return { existed: false, created: false, class: null };
  const meta = getMeta() || {};
  const classes = Array.isArray(meta.classes) ? meta.classes.slice() : [];
  const idx = classes.findIndex(c => c.name === nm);
  if (idx >= 0) {
    // 已存在：若原本无科目且本次提供了科目，则补全
    if (!classes[idx].subject && subject) {
      classes[idx] = { name: nm, subject: subject };
      setMeta({ classes });
    }
    return { existed: true, created: false, class: classes[idx] };
  }
  const cls = { name: nm, subject: subject || '' };
  classes.push(cls);
  setMeta({ classes });
  return { existed: false, created: true, class: cls };
}

/**
 * 全量归类：扫描所有学生，按各自 className 批量确保对应班级存在。
 * 用于修复历史数据（已存在学生但未建对应班级卡片）或导入前统一归类。
 * @returns {{totalStudents:number, distinctClasses:number, created:string[], existed:string[]}}
 */
function reconcileClassesFromStudents() {
  const stus = getAll('students');
  const names = [];
  const seen = new Set();
  for (const s of stus) {
    const nm = normClassName(s.className);
    if (nm && !seen.has(nm)) { seen.add(nm); names.push(nm); }
  }
  const created = [], existed = [];
  for (const nm of names) {
    const r = ensureClass(nm);
    (r.created ? created : existed).push(nm);
  }
  return {
    totalStudents: stus.length,
    distinctClasses: names.length,
    created,
    existed
  };
}

/* ---------- 导出 / 导入 ---------- */
const ALL_STORES = Object.keys(STORE_TABLE);
const SKIP_IMPORT = new Set(['meta', 'accounts']); // 导入时不覆盖账号

function exportAll() {
  const out = {};
  for (const s of ALL_STORES) out[s] = getAll(s);
  return out;
}

const importAll = transaction(function(data) {
  for (const s of ALL_STORES) {
    if (SKIP_IMPORT.has(s)) continue;
    if (!data[s]) continue;
    const table = STORE_TABLE[s];
    db.prepare(`DELETE FROM ${table}`).run();
    for (const obj of data[s]) {
      putRaw(s, obj);
    }
  }
  appendLog({
    store: 'meta', action: 'rollback', entityId: 0,
    before: null, after: null, note: '导入数据备份'
  });
});

/* ---------- 工具函数 ---------- */
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

/* ---------- 版本迁移（兼容旧数据） ---------- */
function migrate() {
  const m = getMeta();
  if (!m) return;
  if (!m.classes || !Array.isArray(m.classes) || m.classes.length === 0) {
    const name = (m.className || '').trim() || '默认班级';
    m.classes = [{ name, subject: (m.subject || '').trim() }];
    setMeta({ classes: m.classes });
  }
  const defaultName = (m.classes[0] && m.classes[0].name) || '';
  const stus = getAll('students');
  let changed = false;
  for (const s of stus) {
    if (!s.className) { s.className = defaultName; putRaw('students', s); changed = true; }
  }
}

module.exports = {
  db, dbPath: DB_PATH,
  STORE_TABLE, TABLE_STORE, ALL_STORES, CLASS_TABLES,
  getAll, get, putRaw, delRaw,
  appendLog, op, rollback,
  getMeta, setMeta, hashPassword, verifyPassword,
  getAccounts, addAccount, verifyAccount, updateAccount, deleteAccount, getAccountById,
  createSession, getSession, deleteSession,
  exportAll, importAll,
  ensureClass, reconcileClassesFromStudents,
  actionText, storeLabel, migrate
};
