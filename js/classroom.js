/* ============================================================
   classroom.js · 教室助手（教师操作 · 功能受限）
   - 账号绑定班级，仅展示绑定班级信息（学生无法改动）
   - 左侧可折叠导航：课堂首页 / 课堂点名 / 作业展示
   - 课堂首页：只读概览  · 点名：写回考勤（同步办公室）· 作业展示
   ============================================================ */
(function (global) {
  'use strict';

  // App 在 app.js 中定义，本文件先于 app.js 加载，故延迟到 render 时取用
  let A = null;
  const $ = (s, r = document) => A.$(s, r);
  const $$ = (s, r = document) => A.$$(s, r);
  const esc = (s) => A.esc(s);

  function myClass() { return A.activeClass() || ''; }   // 教室账号绑定的班级
  async function students() {
    const all = await DB.getAll('students');
    const c = myClass();
    return all.filter(s => (s.className || '') === c).sort((a, b) => (a.no || '').localeCompare(b.no || ''));
  }
  function byClass(list) { const c = myClass(); return c ? list.filter(r => (r.className || '') === c) : list; }
  function sidName(list, id) { const s = list.find(x => x.id === id); return s ? s.name : '未知'; }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${A.pad(d.getMonth() + 1)}-${A.pad(d.getDate())}`; }
  function byDateDesc(a, b) { return (b.date || '').localeCompare(a.date || ''); }

  /* 点名状态机 */
  const ATT_ORDER = ['出勤', '迟到', '请假', '缺课'];
  const ATT_CLS = { 出勤: 'green', 迟到: 'orange', 请假: 'yellow', 缺课: 'red' };
  let rc = { students: [], status: {}, date: '', period: 1, selected: null, picked: new Set(), noRepeat: false };

  let navEl = null, mainEl = null;

  /* ---------- 外壳：可折叠导航 + 主区 ---------- */
  async function render(c) {
    A = window.App;
    const c0 = myClass();
    const subj = A.classSubject(c0);
    c.innerHTML = `
      <div class="cr-app">
        <aside class="cr-nav" id="crNav">
          <div class="cr-brand">📚 课堂助手</div>
          <button class="cr-toggle" id="crToggle" title="折叠/展开">‹</button>
          <nav class="cr-menu" id="crMenu">
            <a class="cr-item active" data-cr="home">🏠 <span>课堂首页</span></a>
            <a class="cr-item" data-cr="rollcall">🙋 <span>课堂点名</span></a>
            <a class="cr-item" data-cr="homework">📚 <span>作业展示</span></a>
          </nav>
          <div class="cr-foot">
            <div class="cr-acc">🎯 ${esc(c0 || '未绑定班级')} · ${esc(subj || '')}</div>
            <button class="btn btn-ghost btn-sm" id="cbFs">⛶ 全屏</button>
            <button class="btn btn-ghost btn-sm" id="cbExit">退出</button>
          </div>
        </aside>
        <main class="cr-main" id="crMain"></main>
      </div>`;
    navEl = $('#crMenu'); mainEl = $('#crMain');
    $('#crToggle').onclick = () => $('#crNav').classList.toggle('mini');
    $$('#crMenu .cr-item', navEl).forEach(a => a.onclick = () => {
      $$('#crMenu .cr-item', navEl).forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      crRoute(a.dataset.cr);
    });
    $('#cbFs').onclick = () => {
      const d = document.documentElement;
      if (!document.fullscreenElement) { if (d.requestFullscreen) d.requestFullscreen(); }
      else if (document.exitFullscreen) document.exitFullscreen();
    };
    $('#cbExit').onclick = async () => {
      if (await A.confirmBox('退出课堂模式？将返回登录界面。', { okText: '退出' })) {
        await DB.logout();        // 清除令牌并注销服务端会话（教室端之前漏了这步）
        location.reload();        // 重载后 initGate 无有效令牌 → 回到登录页
      }
    };
    crRoute('home');
  }

  async function crRoute(name) {
    mainEl.innerHTML = `<div class="empty">加载中…</div>`;
    if (name === 'home') await home();
    else if (name === 'rollcall') await rollcall();
    else if (name === 'homework') await homework();
  }

  /* =======================================================
     课堂首页（只读概览）
     ======================================================= */
  async function home() {
    if (!myClass()) { mainEl.innerHTML = `<div class="cr-empty">该教室账号未绑定班级，请在办公室端「账号管理」中绑定。</div>`; return; }
    const stu = await students();
    const subj = A.classSubject(myClass());
    mainEl.innerHTML = `
      <div class="cr-top">
        <div class="cr-title">${esc(myClass())} · ${esc(subj)} · 课堂首页</div>
        <div class="cr-sub">${A.fmtDate()} · ${esc(A.meta.semester || '')}</div>
      </div>
      <div class="cr-grid" id="crGrid"></div>`;
    const grid = $('#crGrid', mainEl);
    await buildSchedule(grid);
    await buildAttendance(grid, stu);
    await buildHomework(grid, stu);
    await buildDiscipline(grid, stu);
    await buildTeaching(grid);
  }

  function section(parent, icon, title, inner) {
    const d = document.createElement('section');
    d.className = 'cr-card';
    d.innerHTML = `<h3 class="cr-card-title">${icon} ${title}</h3><div class="cr-card-body">${inner}</div>`;
    parent.appendChild(d);
    return d;
  }

  async function buildSchedule(parent) {
    const day = new Date().getDay(); // 0=周日
    const DAYS = ['周一', '周二', '周三', '周四', '周五'];
    if (day < 1 || day > 5) {
      section(parent, '📅', '今日课程', `<div class="cr-empty">今天是周末，无课程安排</div>`);
      return;
    }
    const all = byClass(await DB.getAll('schedule'));
    const items = [];
    for (let p = 1; p <= 8; p++) {
      const cell = all.find(x => x.day === day && x.period === p);
      if (cell) items.push({ p, cell });
    }
    const inner = items.length
      ? `<ul class="cr-lessons">${items.map(i => `<li><span class="cr-period">第${i.p}节</span><span class="cr-subj">${esc(i.cell.subject || '')}</span>${i.cell.note ? `<span class="cr-note">${esc(i.cell.note)}</span>` : ''}</li>`).join('')}</ul>`
      : `<div class="cr-empty">今日无课程安排</div>`;
    section(parent, '📅', `今日课程（${DAYS[day - 1]}）`, inner);
  }

  async function buildAttendance(parent, stu) {
    const all = byClass(await DB.getAll('attendance')).sort(byDateDesc);
    if (!all.length) { section(parent, '📋', '课堂考勤', `<div class="cr-empty">暂无考勤记录</div>`); return; }
    const rec = all[0];
    const recs = rec.records || [];
    const late = recs.filter(x => x.status === '迟到');
    const leave = recs.filter(x => x.status === '请假');
    const absent = recs.filter(x => x.status === '缺课');
    const names = arr => arr.map(x => esc(sidName(stu, x.studentId))).join('、') || '无';
    const inner = `
      <div class="cr-date">最近记录：${esc(rec.date || '')}</div>
      <div class="cr-stats">
        <div class="cr-stat"><span class="cr-num">${recs.length}</span><span class="cr-lbl">总记录</span></div>
        <div class="cr-stat warn"><span class="cr-num">${late.length}</span><span class="cr-lbl">迟到</span></div>
        <div class="cr-stat"><span class="cr-num">${leave.length}</span><span class="cr-lbl">请假</span></div>
        <div class="cr-stat warn"><span class="cr-num">${absent.length}</span><span class="cr-lbl">缺课</span></div>
      </div>
      <p class="cr-line"><b class="t-orange">迟到：</b>${names(late)}</p>
      <p class="cr-line"><b class="t-yellow">请假：</b>${names(leave)}</p>
      <p class="cr-line"><b class="t-red">缺课：</b>${names(absent)}</p>`;
    section(parent, '📋', '课堂考勤', inner);
  }

  async function buildHomework(parent, stu) {
    const collect = byClass(await DB.getAll('homeworkCollect')).sort(byDateDesc);
    const assign = byClass(await DB.getAll('homeworkAssign')).sort(byDateDesc);
    let inner = '';
    if (collect.length) {
      const c0 = collect[0];
      const recs = c0.records || [];
      let total = 0, submit = 0, unc = 0;
      recs.forEach(x => { total++; if (x.submitted) submit++; if (x.submitted && !x.corrected) unc++; });
      const rate = total ? Math.round(submit / total * 100) : 0;
      const unSub = recs.filter(x => !x.submitted).map(x => esc(sidName(stu, x.studentId))).join('、') || '无';
      const uncList = recs.filter(x => x.submitted && !x.corrected).map(x => esc(sidName(stu, x.studentId))).join('、') || '无';
      inner += `
        <div class="cr-date">最近收缴：${esc(c0.date || '')} ${esc(c0.content || '') ? '· ' + esc(c0.content) : ''}</div>
        <div class="cr-stats">
          <div class="cr-stat ok"><span class="cr-num">${rate}%</span><span class="cr-lbl">收缴率</span></div>
          <div class="cr-stat warn"><span class="cr-num">${total - submit}</span><span class="cr-lbl">未交</span></div>
          <div class="cr-stat warn"><span class="cr-num">${unc}</span><span class="cr-lbl">未订正</span></div>
        </div>
        <p class="cr-line"><b class="t-red">未交：</b>${unSub}</p>
        <p class="cr-line"><b class="t-orange">未订正：</b>${uncList}</p>`;
    } else {
      inner += `<div class="cr-empty">暂无收缴记录</div>`;
    }
    const today = todayStr();
    const todayHw = assign.filter(r => (r.date || '').slice(0, 10) === today).slice(0, 4);
    if (todayHw.length) {
      inner += `<hr class="cr-hr"><div class="cr-date">今日作业</div>` +
        todayHw.map(r => `<p class="cr-line">📝 ${esc(r.date || '')}：${esc(r.content || '')}${r.deadline ? ` <span class="muted">（截止 ${esc(r.deadline)}）</span>` : ''}</p>`).join('');
    }
    section(parent, '📥', '作业收缴', inner);
  }

  async function buildDiscipline(parent, stu) {
    const all = byClass(await DB.getAll('discipline')).sort(byDateDesc);
    if (!all.length) { section(parent, '🌟', '课堂纪律', `<div class="cr-empty">暂无纪律记录</div>`); return; }
    const rec = all[0];
    const recs = rec.records || [];
    const praise = recs.filter(x => x.type === '表扬');
    const watch = recs.filter(x => x.type === '需关注');
    const names = arr => arr.map(x => `${esc(sidName(stu, x.studentId))}${x.note ? `（${esc(x.note)}）` : ''}`).join('、') || '无';
    const inner = `
      <div class="cr-date">最近记录：${esc(rec.date || '')}</div>
      <p class="cr-line"><b class="t-green">表扬：</b>${names(praise)}</p>
      <p class="cr-line"><b class="t-orange">需关注：</b>${names(watch)}</p>`;
    section(parent, '🌟', '课堂纪律', inner);
  }

  async function buildTeaching(parent) {
    const all = byClass(await DB.getAll('teachingRecords')).sort(byDateDesc);
    if (!all.length) { section(parent, '📖', '课堂教学记录', `<div class="cr-empty">暂无教学记录</div>`); return; }
    const r = all[0];
    const inner = `
      <div class="cr-date">最近记录：${esc(r.date || '')} · 第${esc(r.period || 1)}节</div>
      ${r.progress ? `<p class="cr-line"><b>进度：</b>${esc(r.progress)}</p>` : ''}
      ${r.keyPoints ? `<p class="cr-line"><b>重难点：</b>${esc(r.keyPoints)}</p>` : ''}
      ${r.adjustment ? `<p class="cr-line"><b>调整：</b>${esc(r.adjustment)}</p>` : ''}
      ${r.studentSituation ? `<p class="cr-line"><b>学情：</b>${esc(r.studentSituation)}</p>` : ''}`;
    section(parent, '📖', '课堂教学记录', inner);
  }

  /* =======================================================
     课堂点名
     ======================================================= */
  async function rollcall() {
    if (!myClass()) { mainEl.innerHTML = `<div class="cr-empty">该教室账号未绑定班级，请在办公室端「账号管理」中绑定。</div>`; return; }
    const stu = await students();
    rc.students = stu;
    rc.date = todayStr();
    rc.selected = null;
    const all = (await DB.getAll('attendance')).filter(r => (r.date || '').slice(0, 10) === rc.date && (r.className || '') === myClass()).sort(byDateDesc);
    const existing = all[0];
    rc.status = {};
    rc.picked = new Set();
    rc.noRepeat = false;
    stu.forEach(s => rc.status[s.id] = '出勤');
    if (existing) {
      rc.period = existing.period || 1;
      (existing.records || []).forEach(r => { if (rc.status[r.studentId] !== undefined) rc.status[r.studentId] = r.status; });
    } else rc.period = 1;
    renderRollcall();
  }

  function renderRollcall() {
    const c0 = myClass();
    mainEl.innerHTML = `
      <div class="rc-stage">
        <div class="cr-top">
          <div class="cr-title">🙋 课堂点名 · ${esc(c0)}</div>
          <div class="cr-sub">点击学生卡片可切换状态：出勤 → 迟到 → 请假 → 缺课</div>
        </div>
        <div class="rc-toolbar">
          <label class="row" style="gap:6px">日期 <input type="date" id="rcDate" class="input rc-input" value="${esc(rc.date)}"></label>
          <label class="row" style="gap:6px">节次 <input type="number" id="rcPeriod" class="input rc-input" min="1" value="${esc(rc.period)}"></label>
        </div>
        <div class="rc-pick" id="rcPick" style="display:none"></div>
        <div class="rc-summary" id="rcSummary"></div>
        <div class="rc-grid" id="rcGrid"></div>
        <div class="rc-bottombar">
          <label class="rc-check" title="勾选后，同一次进入点名页面不会重复点到已选过的学生"><input type="checkbox" id="rcNoRepeat" ${rc.noRepeat ? 'checked' : ''}> 不重复点名</label>
          <button class="btn btn-yellow rc-big-btn" id="rcRandom">🎲 随机点名</button>
          <button class="btn btn-ghost btn-sm" id="rcReset">↺ 全部出勤</button>
          <button class="btn btn-primary btn-sm" id="rcSave">💾 保存点名</button>
        </div>
      </div>`;

    const grid = $('#rcGrid', mainEl);
    rc.students.forEach(s => {
      const card = A.el(`<div class="rc-stu" data-id="${s.id}">
        <div class="rc-stu-no">${esc(s.no || '')}</div>
        <div class="rc-stu-name">${esc(s.name)}</div>
        <div class="rc-stu-status tag"></div>
      </div>`);
      card.onclick = () => cycleStatus(s.id);
      grid.appendChild(card);
    });
    updateAllCards();
    updateSummary();

    $('#rcDate', mainEl).onchange = (e) => { rc.date = e.target.value; rollcall(); };
    $('#rcPeriod', mainEl).onchange = (e) => { rc.period = e.target.value || 1; };
    $('#rcNoRepeat', mainEl).onchange = (e) => { rc.noRepeat = e.target.checked; };
    $('#rcRandom', mainEl).onclick = randomPick;
    $('#rcReset', mainEl).onclick = () => { rc.students.forEach(s => rc.status[s.id] = '出勤'); updateAllCards(); updateSummary(); };
    $('#rcSave', mainEl).onclick = saveRollcall;
  }

  function cycleStatus(id) {
    const i = ATT_ORDER.indexOf(rc.status[id]);
    rc.status[id] = ATT_ORDER[(i + 1) % ATT_ORDER.length];
    updateCard(id);
    updateSummary();
  }
  function updateCard(id) {
    const card = $(`.rc-stu[data-id="${id}"]`, mainEl);
    if (!card) return;
    const st = rc.status[id];
    card.className = 'rc-stu ' + ATT_CLS[st];
    const tag = card.querySelector('.rc-stu-status');
    tag.textContent = st;
    tag.className = 'rc-stu-status tag ' + ATT_CLS[st];
  }
  function updateAllCards() { rc.students.forEach(s => updateCard(s.id)); }
  function updateSummary() {
    const box = $('#rcSummary', mainEl); if (!box) return;
    let c = { 出勤: 0, 迟到: 0, 请假: 0, 缺课: 0 };
    rc.students.forEach(s => c[rc.status[s.id]]++);
    box.innerHTML = `
      <div class="cr-stat ok"><span class="cr-num">${c.出勤}</span><span class="cr-lbl">出勤</span></div>
      <div class="cr-stat warn"><span class="cr-num">${c.迟到}</span><span class="cr-lbl">迟到</span></div>
      <div class="cr-stat"><span class="cr-num">${c.请假}</span><span class="cr-lbl">请假</span></div>
      <div class="cr-stat warn"><span class="cr-num">${c.缺课}</span><span class="cr-lbl">缺课</span></div>`;
  }
  function randomPick() {
    if (!rc.students.length) return;
    let pool = rc.students;
    if (rc.noRepeat) {
      const remaining = rc.students.filter(s => !rc.picked.has(s.id));
      if (remaining.length === 0) {
        rc.picked.clear();
        A.toast('本轮点名已全部覆盖，已重置不重复记录', 'warn');
      } else {
        pool = remaining;
      }
    }
    const s = pool[Math.floor(Math.random() * pool.length)];
    rc.selected = s.id;
    rc.picked.add(s.id);
    const box = $('#rcPick', mainEl);
    box.style.display = 'block';
    box.innerHTML = `🎯 请 <b>${esc(s.name)}</b> 同学（${esc(s.no || '—')}）准备回答`;
  }
  async function saveRollcall() {
    const c0 = myClass();
    const records = rc.students.map(s => ({ studentId: s.id, status: rc.status[s.id] }));
    const payload = { date: rc.date, period: rc.period, className: c0, records };
    const all = await DB.getAll('attendance');
    const existing = all.find(r => (r.date || '').slice(0, 10) === rc.date && (r.className || '') === c0);
    if (existing) await DB.op('attendance', 'update', { id: existing.id, data: payload });
    else await DB.op('attendance', 'create', { data: payload });
    A.toast('点名已保存，并同步到办公室', 'ok');
  }

  /* =======================================================
     作业展示
     ======================================================= */
  async function homework() {
    if (!myClass()) { mainEl.innerHTML = `<div class="cr-empty">该教室账号未绑定班级，请在办公室端「账号管理」中绑定。</div>`; return; }
    const stu = await students();
    const assign = byClass(await DB.getAll('homeworkAssign')).sort(byDateDesc);
    const collect = byClass(await DB.getAll('homeworkCollect')).sort(byDateDesc);
    const works = byClass(await DB.getAll('homeworkWorks')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    mainEl.innerHTML = `
      <div class="cr-top">
        <div class="cr-title">📚 作业展示 · ${esc(myClass())}</div>
        <div class="cr-sub">作业布置 · 收缴情况 · 学生作业</div>
      </div>
      <div class="hw-tabs" id="hwTabs">
        <button class="hw-tab active" data-t="assign">📝 作业布置</button>
        <button class="hw-tab" data-t="collect">📥 收缴情况</button>
        <button class="hw-tab" data-t="works">🖼️ 学生作业</button>
      </div>
      <div class="hw-panel" id="hwPanel"></div>`;

    const panel = $('#hwPanel', mainEl);
    panel.innerHTML = `<div id="hwAssignBox"></div><div id="hwCollectBox"></div><div id="hwWorksBox"></div>`;
    renderHwAssign($('#hwAssignBox', mainEl), assign);
    renderHwCollect($('#hwCollectBox', mainEl), collect, stu);
    renderHwWorks($('#hwWorksBox', mainEl), works, stu);

    $$('#hwTabs .hw-tab', mainEl).forEach(t => t.onclick = () => {
      $$('#hwTabs .hw-tab', mainEl).forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      showHwTab(t.dataset.t);
    });
    showHwTab('assign');
  }
  function showHwTab(t) {
    ['assign', 'collect', 'works'].forEach(k => {
      const el = $('#hw' + (k === 'works' ? 'Works' : k.charAt(0).toUpperCase() + k.slice(1)) + 'Box', mainEl);
      if (el) el.style.display = (k === t) ? 'block' : 'none';
    });
  }

  function renderHwAssign(box, list) {
    if (!list.length) { box.innerHTML = `<div class="cr-empty">暂无作业布置</div>`; return; }
    box.innerHTML = `<div class="cr-grid">` + list.slice(0, 30).map(r => `
      <section class="cr-card">
        <h3 class="cr-card-title">📝 ${esc((r.date || '').slice(0, 10))}</h3>
        <div class="cr-card-body">
          <p class="cr-line">${esc(r.content || '')}</p>
          ${r.deadline ? `<p class="cr-date">截止：${esc(r.deadline)}</p>` : ''}
        </div>
      </section>`).join('') + `</div>`;
  }

  function renderHwCollect(box, list, stu) {
    if (!list.length) { box.innerHTML = `<div class="cr-empty">暂无收缴记录</div>`; return; }
    box.innerHTML = `<div class="cr-grid">` + list.slice(0, 30).map(r => {
      const recs = r.records || [];
      const sub = recs.filter(x => x.submitted), unSub = recs.filter(x => !x.submitted), unc = recs.filter(x => x.submitted && !x.corrected);
      const rate = recs.length ? Math.round(sub.length / recs.length * 100) : 0;
      return `<section class="cr-card">
        <h3 class="cr-card-title">📥 ${esc(r.date || '')} ${esc(r.content || '') ? '· ' + esc(r.content) : ''}</h3>
        <div class="cr-card-body">
          <div class="cr-stats">
            <div class="cr-stat ok"><span class="cr-num">${rate}%</span><span class="cr-lbl">收缴率</span></div>
            <div class="cr-stat warn"><span class="cr-num">${unSub.length}</span><span class="cr-lbl">未交</span></div>
            <div class="cr-stat warn"><span class="cr-num">${unc.length}</span><span class="cr-lbl">未订正</span></div>
          </div>
          ${unSub.length ? `<p class="cr-line"><b class="t-red">未交：</b>${unSub.map(x => esc(sidName(stu, x.studentId))).join('、') || '无'}</p>` : ''}
          ${unc.length ? `<p class="cr-line"><b class="t-orange">未订正：</b>${unc.map(x => esc(sidName(stu, x.studentId))).join('、') || '无'}</p>` : ''}
        </div>
      </section>`;
    }).join('') + `</div>`;
  }

  function renderHwWorks(box, list, stu) {
    if (!list.length) { box.innerHTML = `<div class="cr-empty">暂无学生作业内容（请在办公室端「作业收缴 → 学生作业管理」中添加）</div>`; return; }
    box.innerHTML = `<div class="hw-works">` + list.map(w => {
      const name = w.studentName || sidName(stu, w.studentId);
      const media = w.type === 'image'
        ? `<img src="${w.content}" alt="${esc(name)}的作业">`
        : `<div class="hw-work-text">${esc(w.content || '')}</div>`;
      return `<div class="hw-work">
        ${media}
        <div class="hw-work-body">
          <div class="hw-work-name">${esc(name)}</div>
          ${w.note ? `<div class="hw-work-note">${esc(w.note)}</div>` : ''}
        </div>
      </div>`;
    }).join('') + `</div>`;
  }

  global.Classroom = { render };
})(window);
