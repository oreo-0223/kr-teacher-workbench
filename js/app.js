/* ============================================================
   app.js · 主控制器
   - 多账号门禁：办公室（管理员）/ 教室展示（只读）两种角色
   - 多班级：meta.classes = [{name, subject}]；每班学生独立归属
   - 办公室：顶栏班级选择器（各班 + 全部班级），所有页面按班级过滤
   - 教室：账号绑定班级，仅展示绑定班级信息
   - 侧边栏折叠 / 平板抽屉 / 全局抽屉·模态·提示 / 云端同步
   ============================================================ */
(function (global) {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let meta = null;
  let currentUser = null;          // 当前登录账号
  let mode = 'office';             // 'office' | 'classroom'
  let shellBound = false;
  let currentRoute = 'workbench';
  // 当前班级：'__all__' = 全部班级；否则为某个班级名
  let currentClass = '__all__';
  let classChosen = false;

  /* ---------- UI 工具 ---------- */
  function toast(msg, type = '') {
    const w = $('#toastWrap');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    w.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2400);
    setTimeout(() => el.remove(), 2800);
  }
  function openDrawer(title, html) {
    $('#drawerTitle').textContent = title;
    $('#drawerBody').innerHTML = html;
    $('#drawer').classList.add('open');
    $('#overlay').classList.add('show');
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#overlay').classList.remove('show');
  }
  function openModal({ title, body, foot }) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = foot || '';
    $('#modal').classList.add('show');
  }
  function closeModal() { $('#modal').classList.remove('show'); }

  function confirmBox(msg, opts = {}) {
    return new Promise(resolve => {
      openModal({
        title: opts.title || '请确认',
        body: `<p style="margin:0 0 4px;">${msg}</p>${opts.hint ? `<p class="muted" style="margin:0;">${opts.hint}</p>` : ''}`,
        foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${opts.okText || '确定'}</button>`
      });
      $('#modalFoot').onclick = e => {
        const act = e.target.dataset.act;
        closeModal();
        resolve(act === 'ok');
      };
    });
  }

  function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function fmtDate(d = new Date()) {
    const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 周${w}`;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------- 班级相关辅助（暴露给各模块） ---------- */
  function classList() { return (meta && meta.classes && meta.classes.length) ? meta.classes : []; }
  function classSubject(name) {
    const c = classList().find(x => x.name === name);
    return c ? (c.subject || '') : '';
  }
  function ensureClass() {
    if (!classChosen) { const c = classList()[0]; currentClass = c ? c.name : '__all__'; classChosen = true; }
    // 绑定班级失效时回退到第一个班级
    if (currentClass !== '__all__' && !classList().some(c => c.name === currentClass)) {
      const c = classList()[0]; currentClass = c ? c.name : '__all__';
    }
  }
  // 办公室：返回班级名或 null（全部）；教室：返回绑定班级名
  function activeClass() {
    if (mode === 'classroom') return currentUser && currentUser.bindingClass;
    return currentClass === '__all__' ? null : currentClass;
  }
  function isAll() { return mode === 'office' && activeClass() === null; }
  async function studentsOf(className) {
    const all = await DB.getAll('students');
    const filtered = className ? all.filter(s => s.className === className) : all;
    return filtered.sort((a, b) => (a.no || '').localeCompare(b.no || '', 'zh'));
  }
  function setActiveClass(name) { currentClass = name; rerender(); }

  function rerender() {
    if (mode === 'classroom') { Classroom.render($('#content')); }
    else { route(currentRoute); }
  }

  /* ---------- 门禁 ---------- */
  async function initGate() {
    await DB.open();
    await DB.migrateV1();
    const status = await DB.checkSetup();
    meta = status.meta || null;
    const accounts = status.accounts || [];
    const gate = $('#gate');
    if (status.needsSetup) {
      renderSetupGate(gate);
      gate.classList.remove('hidden');
      const f0 = gate.querySelector('input');
      if (f0) setTimeout(() => f0.focus(), 60);
      return;
    }
    // 已初始化：若本地仍保存着有效登录令牌，则自动恢复会话（刷新/重开页面保持登录）
    try {
      const acc = await DB.me();
      if (acc) { enterApp(acc); return; }
    } catch (_) { /* 令牌失效，走登录流程 */ }
    // 无有效会话 → 显示登录页
    renderLoginGate(gate, accounts);
    gate.classList.remove('hidden');
    const f = gate.querySelector('input');
    if (f) setTimeout(() => f.focus(), 60);
  }

  // 首次：创建管理员（办公室）账号 + 基础资料 + 第一个班级
  function renderSetupGate(gate) {
    const card = $('#gateCard');
    card.innerHTML = `
      <div class="gate-logo">📚</div>
      <h1 class="gate-title">科任教师工作台</h1>
      <p class="gate-sub">首次使用，创建管理员账号（办公室）</p>
      <form id="setupForm" class="gate-form">
        <input type="text" id="suUser" class="gate-input" placeholder="登录账号（如 laowang）" autocomplete="off">
        <input type="password" id="suPwd1" class="gate-input" placeholder="登录口令">
        <input type="password" id="suPwd2" class="gate-input" placeholder="确认口令">
        <input type="text" id="suTeacher" class="gate-input" placeholder="教师姓名" autocomplete="off">
        <input type="text" id="suSemester" class="gate-input" placeholder="学年学期（如 2025-2026第二学期）" autocomplete="off">
        <div class="gate-divider">首个任教班级</div>
        <input type="text" id="suClass1" class="gate-input" placeholder="班级名称（如 三年级2班）" autocomplete="off">
        <input type="text" id="suSubject1" class="gate-input" placeholder="该班任教科目（如 科学）" autocomplete="off">
        <button type="submit" class="btn btn-primary gate-btn">完成设置</button>
        <p class="gate-hint" id="gateHint"></p>
      </form>`;
    $('#setupForm').onsubmit = async (e) => {
      e.preventDefault();
      const user = val('suUser'), p1 = val('suPwd1'), p2 = val('suPwd2');
      const teacher = val('suTeacher'), sem = val('suSemester'), cls = val('suClass1'), subj = val('suSubject1');
      if (!user || !teacher || !sem || !cls || !subj) { $('#gateHint').textContent = '请填写账号与所有资料'; return; }
      if (!p1 || p1 !== p2) { $('#gateHint').textContent = '口令为空或两次不一致'; return; }
      meta = await DB.setMeta({ teacher, semester: sem, classes: [{ name: cls, subject: subj }] });
      await DB.addAccount({ username: user, password: p1, role: 'office', displayName: teacher });
      // 重新验证以获取会话 token
      const acc = await DB.verifyAccount(user, p1);
      toast('设置完成，已进入工作台', 'ok');
      enterApp(acc);
    };
  }

  // 已设置：账号登录
  function renderLoginGate(gate, accounts) {
    const card = $('#gateCard');
    const hints = accounts.map(a => `<span class="acct-chip">${esc(a.username)} · ${a.role === 'office' ? '办公室' : '教室(' + esc(a.bindingClass || '未绑定') + ')'}</span>`).join(' ');
    card.innerHTML = `
      <div class="gate-logo">📚</div>
      <h1 class="gate-title">科任教师工作台</h1>
      <p class="gate-sub" id="gateSub">请登录</p>
      <form id="loginForm" class="gate-form">
        <input type="text" id="lgUser" class="gate-input" placeholder="账号" autocomplete="off">
        <input type="password" id="lgPwd" class="gate-input" placeholder="口令" autocomplete="off">
        <button type="submit" class="btn btn-primary gate-btn">进入</button>
        <p class="gate-hint" id="gateHint"></p>
      </form>
      <div class="acct-hints">已有账号：${hints}</div>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const user = val('lgUser'), pwd = val('lgPwd');
      const acc = await DB.verifyAccount(user, pwd);
      if (acc) { $('#lgPwd').value = ''; enterApp(acc); }
      else { $('#gateHint').textContent = '账号或口令不正确'; $('#lgPwd').value = ''; }
    };
  }

  async function enterApp(account) {
    currentUser = account;
    mode = account.role === 'classroom' ? 'classroom' : 'office';
    // 教室账号绑定班级校验
    if (mode === 'classroom') {
      const cls = classList();
      if (!account.bindingClass || !cls.some(c => c.name === account.bindingClass)) {
        account.bindingClass = cls[0] ? cls[0].name : '';
        if (cls[0]) toast('该教室账号未绑定有效班级，已临时指向「' + cls[0].name + '」', 'err');
        else toast('尚未创建任何班级，请在办公室端「设置」中添加', 'err');
      }
    } else {
      ensureClass();
    }
    $('#gate').classList.add('hidden');
    $('#shell').classList.remove('hidden');
    if (!shellBound) { bindShell(); shellBound = true; }
    if (mode === 'classroom') showClassroom();
    else showOffice();
  }

  function showOffice() {
    document.body.classList.remove('mode-classroom');
    $('#sidebar').classList.remove('hidden');
    ensureClass();
    $('#topbar').style.display = '';
    $('#pageTitle').textContent = '工作台';
    updateTopbar();
    if (!$('.nav-item[data-route].active')) $('.nav-item[data-route]').classList.add('active');
    route('workbench');
  }

  function updateTopbar() {
    ensureClass();
    const cls = activeClass();
    const subject = cls ? classSubject(cls) : '';
    const left = isAll() ? '全部班级' : `${cls}（${subject}）`;
    $('#classDropBtn').textContent = `${meta.teacher} · ${left}`;
    $('#dateChip').textContent = fmtDate();
    populateClassDropdown();
  }
  function populateClassDropdown() {
    const menu = $('#classDropMenu');
    if (!menu) return;
    const classes = classList();
    const items = classes.map(c => {
      const active = !isAll() && activeClass() === c.name;
      return `<div class="class-drop-item ${active ? 'active' : ''}" data-value="${esc(c.name)}">
        <span>${esc(c.name)}</span>
        <span class="sub">${esc(c.subject || '')}</span>
      </div>`;
    }).join('');
    const allActive = isAll() ? 'active' : '';
    menu.innerHTML = items + `<div class="class-drop-divider"></div>
      <div class="class-drop-item ${allActive}" data-value="__all__"><span>全部班级</span><span class="sub">汇总所有班级</span></div>`;
  }
  function toggleClassDropdown(show) {
    const menu = $('#classDropMenu');
    if (!menu) return;
    if (show === undefined) menu.classList.toggle('hidden');
    else if (show) menu.classList.remove('hidden');
    else menu.classList.add('hidden');
  }

  function showClassroom() {
    document.body.classList.add('mode-classroom');
    $('#sidebar').classList.add('hidden');
    $('#topbar').style.display = 'none';
    $('#pageTitle').textContent = '课堂助手';
    Classroom.render($('#content'));
  }

  async function doLogout() {
    await DB.logout();      // 清除本地令牌并注销服务端会话（关键：之前漏了这步）
    location.reload();      // 重载后 initGate 无有效令牌 → 自动回到登录页
  }

  // 会话失效（令牌过期等）时，由前端 api.js 派发 kr:session-expired 事件触发，自动回到登录页（不刷新，避免死循环）
  function forceLoginGate() {
    currentUser = null;
    $('#shell').classList.add('hidden');
    $('#gate').classList.remove('hidden');
    DB.checkSetup()
      .then(status => renderLoginGate($('#gate'), status.accounts || []))
      .catch(() => renderLoginGate($('#gate'), []));
  }

  /* ---------- 导航 / 外壳 ---------- */
  const TITLES = { workbench: '工作台', schedule: '课程表', roster: '花名册', grades: '成绩分析' };

  function bindShell() {
    $$('.nav-item[data-route]').forEach(a => {
      a.addEventListener('click', () => {
        $$('.nav-item[data-route]').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        route(a.dataset.route);
        if (window.innerWidth <= 820) { $('#sidebar').classList.remove('mobile-open'); $('#overlay').classList.remove('show'); }
      });
    });
    $('#navToggle').addEventListener('click', () => $('#sidebar').classList.toggle('mini'));
    $('#menuBtn').addEventListener('click', () => {
      $('#sidebar').classList.toggle('mobile-open');
      $('#overlay').classList.toggle('show');
    });
    $('#btnLog').addEventListener('click', () => LogView.open());
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnAccounts').addEventListener('click', openAccounts);
    $('#btnLogout').addEventListener('click', async () => {
      if (await confirmBox('确定退出登录吗？退出后需重新输入账号口令。', { okText: '退出' })) doLogout();
    });
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#modalClose').addEventListener('click', closeModal);
    $('#overlay').addEventListener('click', () => { closeDrawer(); $('#sidebar').classList.remove('mobile-open'); });
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeDrawer(); toggleClassDropdown(false); } });
    $('#classDropBtn').addEventListener('click', e => { e.stopPropagation(); toggleClassDropdown(); });
    $('#classDropMenu').addEventListener('click', e => {
      const item = e.target.closest('.class-drop-item');
      if (!item) return;
      currentClass = item.dataset.value;
      classChosen = true;
      toggleClassDropdown(false);
      updateTopbar();
      route(currentRoute);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#classDropdown')) toggleClassDropdown(false);
    });
  }

  function route(name) {
    currentRoute = name;
    $('#pageTitle').textContent = TITLES[name] || '';
    const c = $('#content');
    c.scrollTop = 0;
    if (name === 'workbench') Workbench.render(c);
    else if (name === 'schedule') Schedule.render(c);
    else if (name === 'roster') Roster.render(c);
    else if (name === 'grades') Grades.render(c);
  }

  /* ---------- 设置 ---------- */
  async function openSettings() {
    const m = await DB.getMeta();
    openModal({
      title: '设置',
      body: `
        <div class="form-row"><label>教师姓名</label><input class="input" id="sTeacher" value="${esc(m.teacher || '')}"></div>
        <div class="form-row"><label>学年学期</label><input class="input" id="sSemester" value="${esc(m.semester || '')}"></div>
        <hr style="border:none;border-top:1px dashed var(--line);margin:14px 0;">
        <div class="between"><b>班级管理</b><button class="btn btn-ghost btn-sm" id="sAddClass">＋ 添加班级</button></div>
        <div id="sClassList" class="mt8"></div>
        <hr style="border:none;border-top:1px dashed var(--line);margin:14px 0;">
        <div class="form-row"><label>修改访问口令（留空则不改）</label><input class="input" id="sPwd1" type="password" placeholder="新口令"></div>
        <div class="form-row"><label>确认新口令</label><input class="input" id="sPwd2" type="password" placeholder="再输一次"></div>
        <hr style="border:none;border-top:1px dashed var(--line);margin:14px 0;">
        <div class="between"><span class="muted">数据备份与恢复</span>
          <span><button class="btn btn-ghost btn-sm" id="sExport">导出备份</button>
          <label class="btn btn-ghost btn-sm" style="margin:0;">导入备份<input type="file" id="sImport" accept="application/json" hidden></label></span>
        </div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="save">保存</button>`
    });
    renderClassList();
    $('#sAddClass').onclick = () => {
      openModal({
        title: '添加班级',
        body: `<div class="form-row"><label>班级名称</label><input class="input" id="nCName" placeholder="如 三年级2班"></div>
          <div class="form-row"><label>任教科目</label><input class="input" id="nCSubj" placeholder="如 科学"></div>`,
        foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">添加</button>`
      });
      $('#modalFoot').onclick = async e => {
        const act = e.target.dataset.act; if (!act) return;
        if (act === 'cancel') { closeModal(); openSettings(); return; }
        if (act === 'ok') {
          const name = val('nCName'), subj = val('nCSubj');
          if (!name) { toast('请填写班级名称', 'err'); return; }
          try {
            await addClass(name, subj);
            closeModal();
            setActiveClass(name);
            updateTopbar();
            toast('班级已添加，已切换到「' + name + '」', 'ok');
            openSettings();
          } catch (err) { toast(err.message, 'err'); }
        }
      };
    };
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act;
      if (act === 'cancel') closeModal();
      if (act === 'save') {
        const patch = { teacher: val('sTeacher'), semester: val('sSemester') };
        const p1 = val('sPwd1'), p2 = val('sPwd2');
        if (p1) { if (p1 !== p2) { toast('两次口令不一致', 'err'); return; } patch.password = p1; }
        meta = await DB.setMeta(patch);
        toast('设置已保存', 'ok');
        closeModal();
        if (!document.body.classList.contains('mode-classroom')) { updateTopbar(); route(currentRoute); }
      }
    };
    $('#sExport').onclick = async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `科任教师数据备份_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast('已导出备份文件', 'ok');
    };
    $('#sImport').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (!(await confirmBox('导入备份将覆盖当前全部数据，确定继续吗？', { danger: true, okText: '覆盖导入', hint: '建议先导出当前数据作为留底。' }))) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await DB.importAll(data);
        meta = await DB.getMeta(); await DB.migrateV1(); meta = await DB.getMeta();
        toast('数据导入成功', 'ok');
        location.reload();
      } catch (err) { toast('文件格式错误：' + err.message, 'err'); }
    };
  }

  function renderClassList() {
    const m = meta || {};
    const classes = (m.classes || []);
    const wrap = $('#sClassList');
    if (!wrap) return;
    if (!classes.length) { wrap.innerHTML = `<div class="empty">暂无班级</div>`; return; }
    wrap.innerHTML = classes.map(c => `
      <div class="acc-row">
        <div class="acc-info"><b>${esc(c.name)}</b><span class="tag yellow">${esc(c.subject || '')}</span></div>
        <div class="acc-ops">
          <button class="btn btn-ghost btn-sm" data-cedit="${esc(c.name)}">改名/科目</button>
          <button class="btn btn-ghost btn-sm" data-cdel="${esc(c.name)}">删除</button>
        </div>
      </div>`).join('');
    $$('[data-cedit]', wrap).forEach(b => b.onclick = async () => {
      const name = b.dataset.cedit;
      const cur = (meta.classes || []).find(c => c.name === name);
      openModal({
        title: '编辑班级',
        body: `<div class="form-row"><label>班级名称</label><input class="input" id="eCName" value="${esc(name)}"></div>
          <div class="form-row"><label>任教科目</label><input class="input" id="eCSubj" value="${esc(cur ? cur.subject || '' : '')}"></div>`,
        foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
      });
      $('#modalFoot').onclick = async e => {
        const act = e.target.dataset.act; if (!act) return;
        if (act === 'cancel') { closeModal(); openSettings(); return; }
        if (act === 'ok') {
          const nn = val('eCName'), subj = val('eCSubj');
          if (!nn) { toast('请填写班级名称', 'err'); return; }
          try {
            await editClass(name, nn, subj);
            closeModal();
            updateTopbar();
            toast('班级已更新', 'ok'); openSettings();
          } catch (err) { toast(err.message, 'err'); }
        }
      };
    });
    $$('[data-cdel]', wrap).forEach(b => b.onclick = async () => {
      const name = b.dataset.cdel;
      if (!(await confirmBox(`删除班级「${name}」？该班级相关考勤/作业/成绩等记录保留但不再显示（可在「全部班级」下查看）。教室账号绑定将被清空。`, { danger: true, okText: '删除' }))) return;
      await deleteClass(name);
      updateTopbar();
      toast('班级已删除', 'ok'); openSettings();
    });
  }

  /* ---------- 班级 CRUD（供花名册 & 设置共用） ---------- */
  async function addClass(name, subject) {
    if (!name) throw new Error('请填写班级名称');
    const classes = (await DB.getMeta()).classes || [];
    if (classes.some(c => c.name === name)) throw new Error('该班级已存在');
    classes.push({ name, subject });
    await DB.setMeta({ classes });
    meta = await DB.getMeta();
    return meta;
  }
  async function editClass(oldName, newName, subject) {
    if (!newName) throw new Error('请填写班级名称');
    const classes = (await DB.getMeta()).classes || [];
    const idx = classes.findIndex(c => c.name === oldName);
    if (idx < 0) throw new Error('班级不存在');
    if (newName !== oldName && classes.some(c => c.name === newName)) throw new Error('该班级名称已存在');
    classes[idx] = { name: newName, subject };
    if (newName !== oldName) {
      const stores = ['attendance', 'discipline', 'homeworkAssign', 'homeworkCollect', 'teachingRecords', 'abnormalLog', 'grades', 'homeworkWorks', 'schedule'];
      for (const st of stores) {
        const list = await DB.getAll(st);
        for (const o of list) { if (o.className === oldName) { o.className = newName; await DB.putRaw(st, o); } }
      }
      const stus = await DB.getAll('students');
      for (const s of stus) { if (s.className === oldName) { s.className = newName; await DB.putRaw('students', s); } }
    }
    await DB.setMeta({ classes });
    meta = await DB.getMeta();
    return meta;
  }
  async function deleteClass(name) {
    const classes = (await DB.getMeta()).classes || [];
    const next = classes.filter(c => c.name !== name);
    await DB.setMeta({ classes: next });
    const accs = await DB.getAccounts();
    for (const a of accs) { if (a.bindingClass === name) { await DB.updateAccount(a.id, { bindingClass: '' }); } }
    meta = await DB.getMeta();
    if (currentClass === name) { currentClass = next[0] ? next[0].name : '__all__'; }
    classChosen = true;
    return meta;
  }

  /* 确保班级存在（幂等，导入自动建班用）：不存在则自动创建，同名不重复 */
  async function ensureClass(name, subject) {
    const r = await DB.ensureClass(name, subject);
    meta = await DB.getMeta();
    return r;
  }
  /* 全量归类：按现有学生的班级字段批量补齐缺失班级 */
  async function reconcileClasses() {
    const r = await DB.reconcileClasses();
    meta = await DB.getMeta();
    return r;
  }

  /* ---------- 账号管理（办公室） ---------- */
  async function openAccounts() {
    const accounts = await DB.getAccounts();
    const officeCount = accounts.filter(a => a.role === 'office').length;
    openModal({
      title: '账号管理',
      body: `
        <p class="muted" style="margin:0 0 10px">办公室账号：完整管理与录入；教室展示账号：绑定某班级，仅查看该班信息（只读）。</p>
        <div id="accList"></div>
        <div class="between mt8"><button class="btn btn-primary btn-sm" id="accAdd">＋ 添加账号</button>
          <span class="muted">当前登录：${esc(currentUser.username)}（${currentUser.role === 'office' ? '办公室' : '教室展示'}）</span></div>`,
      foot: `<button class="btn btn-ghost" data-act="close">关闭</button>`
    });
    $('#modalFoot').onclick = e => { if (e.target.dataset.act === 'close') closeModal(); };
    renderAccList(accounts, officeCount);
    $('#accAdd').onclick = () => openAddAccount(accounts, officeCount);
  }

  function renderAccList(accounts, officeCount) {
    const wrap = $('#accList');
    if (!accounts.length) { wrap.innerHTML = `<div class="empty">暂无账号</div>`; return; }
    wrap.innerHTML = accounts.map(a => `
      <div class="acc-row">
        <div class="acc-info">
          <b>${esc(a.username)}</b>
          <span class="tag ${a.role === 'office' ? 'green' : 'yellow'}">${a.role === 'office' ? '办公室' : '教室展示'}</span>
          ${a.displayName ? `<span class="muted">${esc(a.displayName)}</span>` : ''}
          ${a.role === 'classroom' ? `<span class="muted">🎯 ${esc(a.bindingClass || '未绑定班级')}</span>` : ''}
          ${a.id === currentUser.id ? `<span class="tag soft">当前</span>` : ''}
        </div>
        <div class="acc-ops">
          <button class="btn btn-ghost btn-sm" data-pw="${a.id}">改口令</button>
          ${a.role === 'classroom' ? `<button class="btn btn-ghost btn-sm" data-bind="${a.id}">改班级</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-del="${a.id}" ${canDelete(a, officeCount) ? '' : 'disabled title="不可删除"'} data-role="${a.role}">删除</button>
        </div>
      </div>`).join('');
    $$('[data-pw]', wrap).forEach(b => b.onclick = () => openChangePwd(+b.dataset.pw));
    $$('[data-bind]', wrap).forEach(b => b.onclick = () => openBindClass(+b.dataset.bind, accounts));
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      if (b.disabled) return;
      const id = +b.dataset.del;
      if (!(await confirmBox('确定删除该账号？', { danger: true, okText: '删除' }))) return;
      await DB.deleteAccount(id);
      toast('账号已删除', 'ok');
      const accs = await DB.getAccounts();
      renderAccList(accs, accs.filter(x => x.role === 'office').length);
    });
  }
  function canDelete(a, officeCount) {
    if (a.id === currentUser.id) return false;          // 不能删自己
    if (a.role === 'office' && officeCount <= 1) return false; // 至少保留一个办公室账号
    return true;
  }

  function openAddAccount(accounts, officeCount) {
    const classOpts = classList().map(c => `<option value="${esc(c.name)}">${esc(c.name)}（${esc(c.subject || '')}）</option>`).join('')
      || `<option value="">（请先在设置中添加班级）</option>`;
    openModal({
      title: '添加账号',
      body: `
        <div class="form-row"><label>账号</label><input class="input" id="nUser" placeholder="登录账号" autocomplete="off"></div>
        <div class="form-row"><label>显示名（可选）</label><input class="input" id="nName" placeholder="如 王老师" autocomplete="off"></div>
        <div class="form-row"><label>角色</label><select class="input" id="nRole">
          <option value="office">办公室（完整管理）</option>
          <option value="classroom">教室展示（只读大屏）</option></select></div>
        <div class="form-row" id="nBindRow"><label>绑定班级</label><select class="input" id="nBind">${classOpts}</select></div>
        <div class="form-row"><label>口令</label><input class="input" id="nPwd1" type="password" placeholder="登录口令"></div>
        <div class="form-row"><label>确认口令</label><input class="input" id="nPwd2" type="password" placeholder="再输一次"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">创建</button>`
    });
    const roleSel = $('#nRole');
    const bindRow = $('#nBindRow');
    const syncBindVisibility = () => { bindRow.style.display = roleSel.value === 'classroom' ? '' : 'none'; };
    syncBindVisibility();
    roleSel.onchange = syncBindVisibility;
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') { closeModal(); openAccounts(); return; }
      if (act === 'ok') {
        const username = val('nUser'), name = val('nName'), role = val('nRole');
        const p1 = val('nPwd1'), p2 = val('nPwd2');
        if (!username) { toast('账号不能为空', 'err'); return; }
        if (!p1 || p1 !== p2) { toast('口令为空或两次不一致', 'err'); return; }
        const payload = { username, password: p1, role, displayName: name };
        if (role === 'classroom') payload.bindingClass = val('nBind') || (classList()[0] && classList()[0].name) || '';
        try {
          await DB.addAccount(payload);
          toast('账号已创建', 'ok');
          closeModal();
          openAccounts();
        } catch (err) { toast(err.message || '创建失败', 'err'); }
      }
    };
  }

  function openBindClass(id, accounts) {
    const acc = accounts.find(a => a.id === id);
    const classOpts = classList().map(c => `<option value="${esc(c.name)}" ${c.name === (acc.bindingClass || '') ? 'selected' : ''}>${esc(c.name)}（${esc(c.subject || '')}）</option>`).join('')
      || `<option value="">（请先在设置中添加班级）</option>`;
    openModal({
      title: '修改绑定班级',
      body: `<div class="form-row"><label>账号</label><input class="input" value="${esc(acc.username)}" disabled></div>
        <div class="form-row"><label>绑定班级</label><select class="input" id="bindSel">${classOpts}</select></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') { closeModal(); openAccounts(); return; }
      if (act === 'ok') {
        const bindingClass = val('bindSel');
        await DB.updateAccount(id, { bindingClass });
        toast('绑定班级已更新', 'ok');
        closeModal(); openAccounts();
      }
    };
  }

  function openChangePwd(id) {
    openModal({
      title: '修改口令',
      body: `
        <div class="form-row"><label>新口令</label><input class="input" id="pPwd1" type="password" placeholder="新口令"></div>
        <div class="form-row"><label>确认新口令</label><input class="input" id="pPwd2" type="password" placeholder="再输一次"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') { closeModal(); openAccounts(); return; }
      if (act === 'ok') {
        const p1 = val('pPwd1'), p2 = val('pPwd2');
        if (!p1 || p1 !== p2) { toast('口令为空或两次不一致', 'err'); return; }
        await DB.updateAccount(id, { password: p1 });
        toast('口令已更新', 'ok');
        closeModal(); openAccounts();
      }
    };
  }

  /* ---------- 暴露 ---------- */
  global.App = {
    $, $$, toast, openDrawer, closeDrawer, openModal, closeModal, confirmBox,
    val, el, esc, fmtDate, pad,
    get meta() { return meta; },
    get currentUser() { return currentUser; },
    get mode() { return mode; },
    classList, classSubject, activeClass, isAll, studentsOf, setActiveClass,
    addClass, editClass, deleteClass, ensureClass, reconcileClasses, updateTopbar, populateClassDropdown,
    refreshMeta: async () => { meta = await DB.getMeta(); return meta; }
  };

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', initGate);
})(window);
