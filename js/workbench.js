/* ============================================================
   workbench.js · 工作台
   六大板块卡片 + 详情面板（抽屉）+ 数据录入（均经日志）
   1 课堂考勤  2 课堂纪律  3 作业布置  4 作业收缴
   5 课堂教学记录  6 课堂异常登记
   全部按当前所选班级过滤（"全部班级"时汇总）
   ============================================================ */
(function (global) {
  'use strict';
  const { $, $$, toast, openDrawer, closeDrawer, openModal, closeModal, confirmBox, val, el, esc } = App;

  const ATT = ['出勤', '迟到', '请假', '缺课'];
  const ATT_CLS = { 出勤: 'green', 迟到: 'orange', 请假: 'yellow', 缺课: 'red' };

  // 当前班级（全部时为 null）；单班默认取当前班，全部时取第一个班用于录入默认
  function cls() { return App.activeClass() || (App.classList()[0] && App.classList()[0].name) || ''; }
  async function students() { return App.studentsOf(App.activeClass()); }
  function sidName(list, id) { const s = list.find(x => x.id === id); return s ? s.name : '已删除学生'; }

  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${App.pad(d.getMonth() + 1)}-${App.pad(d.getDate())}`; }
  function escapeHtml(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function byClass(list) { const c = App.activeClass(); return c ? list.filter(r => (r.className || '') === c) : list; }
  async function allStudents() { return App.studentsOf(null); }
  function classSelectHtml(id, selected) {
    const classes = App.classList();
    return `<select class="input" id="${id}">${classes.map(c => `<option value="${esc(c.name)}" ${c.name === selected ? 'selected' : ''}>${esc(c.name)}${c.subject ? '（' + esc(c.subject) + '）' : ''}</option>`).join('')}</select>`;
  }
  function studentsByClass(stu, className) { return className ? stu.filter(s => s.className === className) : stu; }

  /* ---------- 渲染工作台首页 ---------- */
  async function render(c) {
    const m = App.meta;
    const c0 = App.activeClass();
    const clsText = c0 ? `${c0}（${App.classSubject(c0)}）` : '全部班级';
    const stu = await students();
    c.innerHTML = `
      <div class="between mb16">
        <div>
          <p class="section-title"><span class="bar-accent"></span>${m.teacher}老师的工作台</p>
          <p class="section-desc">${clsText} · ${m.semester || ''} · 共 ${stu.length} 名学生</p>
          ${App.isAll() ? '<div class="wb-class-chips" id="wbClassChips"></div>' : ''}
        </div>
      </div>
      <div id="wbToday"></div>
      <div class="grid cards-3" id="wbCards"></div>`;
    if (App.isAll()) {
      const classes = App.classList();
      const chips = await Promise.all(classes.map(async cl => {
        const cs = await App.studentsOf(cl.name);
        return `<span class="wb-chip"><b>${escapeHtml(cl.name)}</b> · ${cs.length} 人</span>`;
      }));
      const cw = $('#wbClassChips'); if (cw) cw.innerHTML = chips.join('');
    }
    await renderToday(c);
    const wrap = $('#wbCards');
    const cards = [
      { key: 'attendance', icon: '📋', title: '课堂考勤', sub: '出勤 / 迟到 / 请假 / 缺课', tag: 'red', tagText: '考勤', loader: loadAttendance },
      { key: 'discipline', icon: '🌟', title: '课堂纪律', sub: '表扬名单 / 需关注学生', tag: 'yellow', tagText: '本周', loader: loadDiscipline },
      { key: 'hwAssign', icon: '📝', title: '作业布置', sub: '每日作业内容', tag: 'yellow', tagText: '作业', loader: loadHwAssign },
      { key: 'hwCollect', icon: '📥', title: '作业收缴', sub: '收缴率 / 未交 / 未订正', tag: 'red', tagText: '统计', loader: loadHwCollect },
      { key: 'teaching', icon: '📖', title: '课堂教学记录', sub: '进度 / 重难点 / 调整 / 学情', tag: 'green', tagText: '记录', loader: loadTeaching },
      { key: 'abnormal', icon: '⚠️', title: '课堂异常登记', sub: '异常情况 / 突发处理', tag: 'red', tagText: '登记', loader: loadAbnormal }
    ];
    for (const card of cards) {
      const node = el(`<div class="card clickable" data-key="${card.key}">
        <div class="card-head">
          <div class="card-title">${card.icon} ${card.title}</div>
          <span class="tag ${card.tag}">${card.tagText}</span>
        </div>
        <div class="card-sub">${card.sub}</div>
        <div class="wb-mini" id="mini-${card.key}"><div class="empty">加载中…</div></div>
      </div>`);
      node.addEventListener('click', () => card.loader());
      wrap.appendChild(node);
    }
    cards.forEach(async card => { try { await summary(card.key); } catch (_) {} });
  }

  /* ---------- 今日待处理 概览 ---------- */
  function goSchedule() {
    const el = document.querySelector('.nav-item[data-route="schedule"]');
    if (el) el.click();
  }
  async function renderToday(c) {
    const wrap = $('#wbToday');
    if (!wrap) return;
    const today = todayStr();
    const dow = new Date().getDay(); // 0=周日 .. 6=周六
    const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const stu = await students();
    const nameOf = id => { const s = stu.find(x => x.id === id); return s ? s.name : '已删除学生'; };

    // 今日课程
    let lessons = [];
    if (dow >= 1 && dow <= 5) {
      lessons = (byClass(await DB.getAll('schedule')).filter(x => x.day === dow))
        .sort((a, b) => (a.period || 0) - (b.period || 0))
        .map(x => `第${x.period || ''}节 ${x.subject || ''}`);
    }
    // 今日截止作业
    const dueToday = byClass(await DB.getAll('homeworkAssign')).filter(a => (a.deadline || '').slice(0, 10) === today);
    // 最近一次收缴：未交 / 未订正
    const collects = byClass(await DB.getAll('homeworkCollect')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    let unSub = [], unc = [];
    if (collects.length) {
      const recs = collects[0].records || [];
      unSub = recs.filter(x => !x.submitted).map(x => nameOf(x.studentId));
      unc = recs.filter(x => x.submitted && !x.corrected).map(x => nameOf(x.studentId));
    }
    // 今日考勤
    const attToday = byClass(await DB.getAll('attendance')).filter(r => (r.date || '').slice(0, 10) === today).length;
    // 近 7 天异常
    const wkStart = new Date(); wkStart.setDate(wkStart.getDate() - 7);
    const abnRecent = byClass(await DB.getAll('abnormalLog')).filter(r => new Date(r.datetime || r.date || '1970') >= wkStart);

    const rows = [];
    if (dow < 1 || dow > 5) {
      rows.push(rd('muted', '📅', '今日课程', '今天是周末，无课程安排', null));
    } else if (lessons.length) {
      rows.push(rd('ok', '📅', '今日课程', lessons.join(' · '), { label: '课程表', act: goSchedule }));
    } else {
      rows.push(rd('muted', '📅', '今日课程', '今天还没有排课', { label: '去排课', act: goSchedule }));
    }
    if (dueToday.length) {
      rows.push(rd('warn', '📝', `${dueToday.length} 项作业今日截止`, dueToday.map(a => (a.content || '').slice(0, 28)).join('；'), { label: '去布置', act: loadHwAssign }));
    }
    if (unSub.length) {
      rows.push(rd('warn', '📥', `${unSub.length} 人未交作业`, clip(unSub), { label: '去收缴', act: loadHwCollect }));
    }
    if (unc.length) {
      rows.push(rd('warn', '✏️', `${unc.length} 人未订正`, clip(unc), { label: '去收缴', act: loadHwCollect }));
    }
    if (attToday === 0) {
      rows.push(rd('danger', '📋', '今日考勤尚未记录', '点击去点名 / 登记', { label: '去考勤', act: loadAttendance }));
    } else {
      rows.push(rd('ok', '📋', '今日考勤已记录', `共 ${attToday} 条`, null));
    }
    if (abnRecent.length) {
      rows.push(rd('danger', '⚠️', `${abnRecent.length} 条异常待跟进（近7天）`, abnRecent.slice(0, 2).map(r => (r.description || r.type || '').slice(0, 22)).join('；'), { label: '看异常', act: loadAbnormal }));
    }
    if (!rows.length) {
      rows.push(rd('ok', '✅', '今日暂无待处理事项', '一切正常，继续加油！', null));
    }

    wrap.innerHTML = `
      <div class="today-panel">
        <div class="today-head"><span class="bar-accent"></span><b>今日待处理</b><span class="muted">${DAYS[dow]} · ${today}</span></div>
        <div class="today-rows">${rows.map((r, i) => `
          <div class="remind-row ${r.cls}">
            <span class="remind-ico">${r.icon}</span>
            <div class="remind-main"><div class="remind-title">${escapeHtml(r.title)}</div>${r.detail ? `<div class="remind-detail">${escapeHtml(r.detail)}</div>` : ''}</div>
            ${r.action ? `<button class="btn btn-ghost btn-sm remind-act" data-i="${i}">${r.action.label}</button>` : ''}
          </div>`).join('')}</div>
      </div>`;
    $$('.remind-act', wrap).forEach(b => {
      const i = +b.dataset.i;
      if (rows[i] && rows[i].action) b.onclick = rows[i].action.act;
    });
  }
  function rd(cls, icon, title, detail, action) { return { cls, icon, title, detail, action }; }
  function clip(arr) { return arr.slice(0, 10).join('、') + (arr.length > 10 ? ' 等' : ''); }

  // 卡片摘要（按班级过滤/汇总）
  async function summary(key) {
    const node = $('#mini-' + key);
    if (!node) return;
    const c = App.activeClass();
    if (key === 'attendance') {
      const all = byClass(await DB.getAll('attendance'));
      const today = todayStr();
      const todayRec = all.filter(r => (r.date || '').slice(0, 10) === today);
      let late = 0, leave = 0, absent = 0;
      todayRec.forEach(r => (r.records || []).forEach(x => { if (x.status === '迟到') late++; if (x.status === '请假') leave++; if (x.status === '缺课') absent++; }));
      node.innerHTML = miniStats([
        { num: todayRec.length, lbl: '今日记录', cls: '' },
        { num: late, lbl: '迟到', cls: 'warn' },
        { num: leave, lbl: '请假', cls: '' },
        { num: absent, lbl: '缺课', cls: 'warn' }
      ]);
    } else if (key === 'discipline') {
      const all = byClass(await DB.getAll('discipline'));
      const now = new Date(); const wStart = new Date(now); wStart.setDate(now.getDate() - 6);
      let praise = 0, watch = 0;
      all.forEach(r => { if (new Date(r.date) >= wStart) (r.records || []).forEach(x => { if (x.type === '表扬') praise++; if (x.type === '需关注') watch++; }); });
      node.innerHTML = miniStats([
        { num: praise, lbl: '本周表扬', cls: 'ok' },
        { num: watch, lbl: '需关注', cls: 'warn' }
      ]);
    } else if (key === 'hwAssign') {
      const all = byClass(await DB.getAll('homeworkAssign')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!all.length) { node.innerHTML = emptyMini('暂无作业布置'); return; }
      node.innerHTML = all.slice(0, 3).map(r => `<div class="list-item"><span class="li-name nowrap">${(r.date || '').slice(5)}</span><span class="li-meta">${escapeHtml(r.content || '').slice(0, 22)}</span></div>`).join('');
    } else if (key === 'hwCollect') {
      const all = byClass(await DB.getAll('homeworkCollect'));
      let submit = 0, total = 0, uncorrected = 0;
      all.forEach(r => (r.records || []).forEach(x => { total++; if (x.submitted) submit++; if (x.submitted && !x.corrected) uncorrected++; }));
      const rate = total ? Math.round(submit / total * 100) : 0;
      node.innerHTML = miniStats([
        { num: rate + '%', lbl: '收缴率', cls: total ? 'ok' : '' },
        { num: total - submit, lbl: '未交', cls: 'warn' },
        { num: uncorrected, lbl: '未订正', cls: 'warn' }
      ]);
    } else if (key === 'teaching') {
      const all = byClass(await DB.getAll('teachingRecords')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!all.length) { node.innerHTML = emptyMini('暂无教学记录'); return; }
      node.innerHTML = all.slice(0, 3).map(r => `<div class="list-item"><span class="li-name nowrap">${(r.date || '').slice(5)}</span><span class="li-meta">${escapeHtml((r.progress || '').slice(0, 22))}</span></div>`).join('');
    } else if (key === 'abnormal') {
      const all = byClass(await DB.getAll('abnormalLog')).sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
      if (!all.length) { node.innerHTML = emptyMini('暂无异常登记'); return; }
      node.innerHTML = all.slice(0, 3).map(r => `<div class="list-item"><span class="tag red">异常</span><span class="li-meta">${escapeHtml((r.description || '').slice(0, 20))}</span></div>`).join('');
    }
  }
  function miniStats(arr) { return `<div class="stat-row">${arr.map(s => `<div class="stat ${s.cls}"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>`).join('')}</div>`; }
  function emptyMini(t) { return `<div class="empty">${t}</div>`; }

  /* =======================================================
     1. 课堂考勤
     ======================================================= */
  async function loadAttendance() {
    const list = byClass(await DB.getAll('attendance')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stu = await students();
    const body = `
      <div class="between mb16"><span class="muted">共 ${list.length} 条考勤记录${App.isAll() ? '（全部班级）' : ''}</span><button class="btn btn-primary btn-sm" id="addAtt">+ 新增考勤</button></div>
      <div id="attList"></div>`;
    openDrawer('📋 课堂考勤', body);
    $('#addAtt').onclick = () => attendanceForm();
    renderAttList(list, stu);
  }
  function renderAttList(list, stu) {
    const wrap = $('#attList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无考勤记录，点右上角新增</div>`; return; }
    wrap.innerHTML = list.map(r => {
      const recs = r.records || [];
      const late = recs.filter(x => x.status === '迟到'), leave = recs.filter(x => x.status === '请假'), absent = recs.filter(x => x.status === '缺课');
      const names = arr => arr.map(x => sidName(stu, x.studentId)).join('、') || '—';
      return `<div class="card mb16" data-id="${r.id}">
        <div class="card-head"><div class="card-title">${r.date} · 第${r.period || 1}节${App.isAll() ? ' · ' + esc(r.className || '') : ''}</div>
          <button class="btn btn-ghost btn-sm" data-del="${r.id}">删除</button></div>
        <div class="row"><span class="tag orange">迟到 ${late.length}</span><span class="muted">${names(late)}</span></div>
        <div class="row mt8"><span class="tag yellow">请假 ${leave.length}</span><span class="muted">${names(leave)}</span></div>
        <div class="row mt8"><span class="tag red">缺课 ${absent.length}</span><span class="muted">${names(absent)}</span></div>
      </div>`;
    }).join('');
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除该考勤记录？此操作可在操作日志中回滚。', { danger: true, okText: '删除' })) {
        await DB.op('attendance', 'delete', { id }); toast('已删除', 'ok'); loadAttendance();
      }
    });
  }
  async function attendanceForm() {
    const allStu = await allStudents();
    const defaultClass = cls();
    openModal({
      title: '新增考勤记录',
      body: `
        <div class="field-inline">
          <div class="form-row"><label>日期</label><input class="input" id="aDate" type="date" value="${todayStr()}"></div>
          <div class="form-row"><label>节次</label><input class="input" id="aPeriod" type="number" min="1" value="1"></div>
        </div>
        <div class="form-row"><label>班级</label>${classSelectHtml('aClass', defaultClass)}</div>
        <p class="muted mb8">逐个选择学生状态（默认出勤）：</p>
        <div id="aStu"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    const box = $('#aStu');
    function render(list) {
      box.innerHTML = list.map(s => `<div class="list-item">
        <span class="li-name">${s.no || ''} ${s.name}</span>
        <div class="row" style="margin-left:auto">
          ${ATT.map((a, i) => `<label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="radio" name="st_${s.id}" value="${a}" ${i === 0 ? 'checked' : ''}>${a}</label>`).join('')}
        </div></div>`).join('') || `<div class="empty">该班级暂无学生</div>`;
    }
    $('#aClass').onchange = () => render(studentsByClass(allStu, $('#aClass').value));
    render(studentsByClass(allStu, defaultClass));
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const date = val('aDate'), period = val('aPeriod') || '1', className = val('aClass');
        if (!date) { toast('请选择日期', 'err'); return; }
        if (!className) { toast('请选择班级', 'err'); return; }
        const currentStu = studentsByClass(allStu, className);
        const records = currentStu.map(s => {
          const status = document.querySelector(`input[name="st_${s.id}"]:checked`).value;
          return { studentId: s.id, status };
        }).filter(x => x.status !== '出勤');
        await DB.op('attendance', 'create', { data: { date, period, className, records } });
        closeModal(); toast('考勤已记录', 'ok'); loadAttendance();
      }
    };
  }

  /* =======================================================
     2. 课堂纪律
     ======================================================= */
  async function loadDiscipline() {
    const list = byClass(await DB.getAll('discipline')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stu = await students();
    const body = `
      <div class="between mb16"><span class="muted">共 ${list.length} 条纪律记录${App.isAll() ? '（全部班级）' : ''}</span><button class="btn btn-primary btn-sm" id="addDis">+ 新增记录</button></div>
      <div id="disList"></div>`;
    openDrawer('🌟 课堂纪律', body);
    $('#addDis').onclick = () => disciplineForm();
    renderDisList(list, stu);
  }
  function renderDisList(list, stu) {
    const wrap = $('#disList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无纪律记录</div>`; return; }
    wrap.innerHTML = list.map(r => {
      const praise = (r.records || []).filter(x => x.type === '表扬');
      const watch = (r.records || []).filter(x => x.type === '需关注');
      const names = arr => arr.map(x => `${sidName(stu, x.studentId)}${x.note ? '（' + escapeHtml(x.note) + '）' : ''}`).join('、') || '—';
      return `<div class="card mb16" data-id="${r.id}">
        <div class="card-head"><div class="card-title">${r.date} · 第${r.period || 1}节${App.isAll() ? ' · ' + esc(r.className || '') : ''}</div>
          <button class="btn btn-ghost btn-sm" data-del="${r.id}">删除</button></div>
        <div class="row"><span class="tag green">表扬 ${praise.length}</span><span class="muted">${names(praise)}</span></div>
        <div class="row mt8"><span class="tag orange">需关注 ${watch.length}</span><span class="muted">${names(watch)}</span></div>
      </div>`;
    }).join('');
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除该纪律记录？', { danger: true, okText: '删除' })) {
        await DB.op('discipline', 'delete', { id }); toast('已删除', 'ok'); loadDiscipline();
      }
    });
  }
  async function disciplineForm() {
    const allStu = await allStudents();
    const defaultClass = cls();
    openModal({
      title: '新增纪律记录',
      body: `
        <div class="field-inline">
          <div class="form-row"><label>日期</label><input class="input" id="dDate" type="date" value="${todayStr()}"></div>
          <div class="form-row"><label>节次</label><input class="input" id="dPeriod" type="number" min="1" value="1"></div>
        </div>
        <div class="form-row"><label>班级</label>${classSelectHtml('dClass', defaultClass)}</div>
        <p class="muted mb8">勾选学生并设置类型（表扬 / 需关注），可填备注：</p>
        <div id="dStu"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    const box = $('#dStu');
    function render(list) {
      box.innerHTML = (list.length ? list : []).map(s => `<div class="list-item">
        <label style="display:flex;align-items:center;gap:6px;min-width:90px"><input type="checkbox" name="chk_${s.id}"> ${s.no || ''} ${s.name}</label>
        <select class="input" name="type_${s.id}" style="width:90px;margin:0 8px 0 auto"><option value="表扬">表扬</option><option value="需关注">需关注</option></select>
        <input class="input" name="note_${s.id}" placeholder="备注" style="flex:1;margin:0">
      </div>`).join('') || `<div class="empty">该班级暂无学生</div>`;
    }
    $('#dClass').onchange = () => render(studentsByClass(allStu, $('#dClass').value));
    render(studentsByClass(allStu, defaultClass));
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const date = val('dDate'); if (!date) { toast('请选择日期', 'err'); return; }
        const className = val('dClass'); if (!className) { toast('请选择班级', 'err'); return; }
        const period = val('dPeriod') || '1';
        const currentStu = studentsByClass(allStu, className);
        const records = currentStu.filter(s => box.querySelector(`input[name="chk_${s.id}"]`).checked).map(s => ({
          studentId: s.id,
          type: box.querySelector(`select[name="type_${s.id}"]`).value,
          note: box.querySelector(`input[name="note_${s.id}"]`).value.trim()
        }));
        if (!records.length) { toast('请至少勾选一名学生', 'err'); return; }
        await DB.op('discipline', 'create', { data: { date, period, className, records } });
        closeModal(); toast('纪律记录已保存', 'ok'); loadDiscipline();
      }
    };
  }

  /* =======================================================
     3. 作业布置
     ======================================================= */
  async function loadHwAssign() {
    const list = byClass(await DB.getAll('homeworkAssign')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const body = `
      <div class="between mb16"><span class="muted">共 ${list.length} 条作业${App.isAll() ? '（全部班级）' : ''}</span><button class="btn btn-primary btn-sm" id="addHa">+ 布置作业</button></div>
      <div id="haList"></div>`;
    openDrawer('📝 作业布置', body);
    $('#addHa').onclick = () => hwAssignForm();
    renderHaList(list);
  }
  function renderHaList(list) {
    const wrap = $('#haList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无作业布置</div>`; return; }
    wrap.innerHTML = list.map(r => `<div class="card mb16" data-id="${r.id}">
      <div class="card-head"><div class="card-title">${r.date}${App.isAll() ? ' · ' + esc(r.className || '') : ''}</div>
        <button class="btn btn-ghost btn-sm" data-del="${r.id}">删除</button></div>
      <p style="margin:4px 0">${escapeHtml(r.content || '')}</p>
      ${r.deadline ? `<p class="muted">截止：${escapeHtml(r.deadline)}</p>` : ''}
    </div>`).join('');
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除该作业布置？', { danger: true, okText: '删除' })) {
        await DB.op('homeworkAssign', 'delete', { id }); toast('已删除', 'ok'); loadHwAssign();
      }
    });
  }
  function hwAssignForm() {
    const defaultClass = cls();
    openModal({
      title: '布置作业',
      body: `<div class="field-inline">
          <div class="form-row"><label>日期</label><input class="input" id="hDate" type="date" value="${todayStr()}"></div>
          <div class="form-row"><label>班级</label>${classSelectHtml('hClass', defaultClass)}</div>
        </div>
        <div class="form-row"><label>作业内容</label><textarea class="input" id="hContent" placeholder="如：完成课本P12练习题1-3题"></textarea></div>
        <div class="form-row"><label>截止日期（可选）</label><input class="input" id="hDeadline" type="date"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const date = val('hDate'); const content = val('hContent');
        const className = val('hClass');
        if (!date || !content) { toast('请填写日期和作业内容', 'err'); return; }
        if (!className) { toast('请选择班级', 'err'); return; }
        await DB.op('homeworkAssign', 'create', { data: { date, className, content, deadline: val('hDeadline') } });
        closeModal(); toast('作业已布置', 'ok'); loadHwAssign();
      }
    };
  }

  /* =======================================================
     4. 作业收缴
     ======================================================= */
  async function loadHwCollect() {
    const list = byClass(await DB.getAll('homeworkCollect')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const assigns = byClass(await DB.getAll('homeworkAssign')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const stu = await students();
    let submit = 0, total = 0, uncorrected = 0;
    list.forEach(r => (r.records || []).forEach(x => { total++; if (x.submitted) submit++; if (x.submitted && !x.corrected) uncorrected++; }));
    const rate = total ? Math.round(submit / total * 100) : 0;
    const body = `
      <div class="card mb16"><div class="card-head"><div class="card-title">📊 收缴统计${App.isAll() ? '（全部班级）' : ''}</div></div>
      <div class="stat-row">
        <div class="stat ${total ? 'ok' : ''}"><div class="num">${rate}%</div><div class="lbl">收缴率</div></div>
        <div class="stat"><div class="num">${submit}/${total}</div><div class="lbl">已交/应交</div></div>
        <div class="stat warn"><div class="num">${total - submit}</div><div class="lbl">未交</div></div>
        <div class="stat warn"><div class="num">${uncorrected}</div><div class="lbl">未订正</div></div>
      </div></div>
      <div class="between mb16"><span class="muted">共 ${list.length} 次收缴记录</span>
        <span>
          <button class="btn btn-yellow btn-sm" id="addWk">🖼️ 学生作业</button>
          <button class="btn btn-primary btn-sm" id="addHc">+ 登记收缴</button>
        </span>
      </div>
      <div id="hcList"></div>`;
    openDrawer('📥 作业收缴', body);
    $('#addHc').onclick = () => hwCollectForm();
    $('#addWk').onclick = () => hwWorksManager(stu);
    renderHcList(list, stu, assigns);
  }
  function renderHcList(list, stu, assigns) {
    const wrap = $('#hcList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无收缴记录</div>`; return; }
    wrap.innerHTML = list.map(r => {
      const recs = r.records || [];
      const sub = recs.filter(x => x.submitted), unSub = recs.filter(x => !x.submitted), unc = recs.filter(x => x.submitted && !x.corrected);
      const assign = r.assignId ? (assigns || []).find(a => a.id === r.assignId) : null;
      const titleText = assign ? (assign.content || '').slice(0, 22) : (r.content || '').slice(0, 22);
      const linkTag = assign ? `<span class="tag green" style="margin-left:6px">已关联布置</span>` : `<span class="tag yellow" style="margin-left:6px">手动记录</span>`;
      return `<div class="card mb16" data-id="${r.id}">
        <div class="card-head"><div class="card-title">${r.date}${App.isAll() ? ' · ' + esc(r.className || '') : ''} · ${escapeHtml(titleText)}${linkTag}</div>
          <span class="row" style="gap:6px"><button class="btn btn-soft btn-sm" data-edit="${r.id}">编辑</button><button class="btn btn-ghost btn-sm" data-del="${r.id}">删除</button></span></div>
        <div class="stat-row">
          <div class="stat ok"><div class="num">${sub.length}/${recs.length}</div><div class="lbl">已交</div></div>
          <div class="stat warn"><div class="num">${unSub.length}</div><div class="lbl">未交</div></div>
          <div class="stat warn"><div class="num">${unc.length}</div><div class="lbl">未订正</div></div>
        </div>
        ${unSub.length ? `<p class="muted mt8">未交：${unSub.map(x => sidName(stu, x.studentId)).join('、')}</p>` : ''}
        ${unc.length ? `<p class="muted">未订正：${unc.map(x => sidName(stu, x.studentId)).join('、')}</p>` : ''}
      </div>`;
    }).join('');
    $$('[data-edit]', wrap).forEach(b => b.onclick = () => {
      const id = +b.dataset.edit;
      const r = list.find(x => x.id === id);
      if (r) hwCollectForm(r);
    });
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除该收缴记录？', { danger: true, okText: '删除' })) {
        await DB.op('homeworkCollect', 'delete', { id }); toast('已删除', 'ok'); loadHwCollect();
      }
    });
  }
  async function hwCollectForm(existing = null) {
    const allStu = await allStudents();
    const allAssigns = await DB.getAll('homeworkAssign');
    const defaultClass = existing ? existing.className : cls();
    openModal({
      title: existing ? '编辑作业收缴' : '登记作业收缴',
      body: `<div class="field-inline">
          <div class="form-row"><label>日期</label><input class="input" id="cDate" type="date" value="${existing ? esc(existing.date) : todayStr()}"></div>
          <div class="form-row"><label>班级</label>${classSelectHtml('cClass', defaultClass)}</div>
        </div>
        <div class="form-row"><label>对应作业布置</label><select class="input" id="cAssign"><option value="">其他（手动输入）</option></select></div>
        <div class="form-row"><label>作业内容（简述）</label><input class="input" id="cContent" placeholder="如：练习三"></div>
        <p class="muted mb8">勾选已交、已订正：</p>
        <div id="cStu"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    const box = $('#cStu');
    const assignSel = $('#cAssign');
    const contentIn = $('#cContent');
    const classSel = $('#cClass');

    // 构建当前班级学生 + 历史记录中已删除学生的合并列表（编辑时保留历史数据）
    function buildList(className) {
      const baseStu = studentsByClass(allStu, className);
      if (!existing || existing.className !== className) {
        return baseStu.map(s => ({ ...s, submitted: false, corrected: false }));
      }
      const map = new Map((existing.records || []).map(r => [r.studentId, r]));
      const list = baseStu.map(s => ({ ...s, submitted: !!map.get(s.id)?.submitted, corrected: !!map.get(s.id)?.corrected }));
      const baseIds = new Set(baseStu.map(s => s.id));
      (existing.records || []).forEach(r => {
        if (!baseIds.has(r.studentId)) {
          list.push({ id: r.studentId, name: '已删除学生', no: '', deleted: true, submitted: !!r.submitted, corrected: !!r.corrected });
        }
      });
      return list;
    }
    function render(list) {
      box.innerHTML = (list.length ? list : []).map(s => `<div class="list-item">
        <span class="li-name ${s.deleted ? 'muted' : ''}">${s.no ? esc(s.no) + ' ' : ''}${escapeHtml(s.name || '')}</span>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px;margin-left:auto"><input type="checkbox" name="sub_${s.id}" ${s.submitted ? 'checked' : ''}> 已交</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px;margin-left:8px"><input type="checkbox" name="cor_${s.id}" ${s.corrected ? 'checked' : ''}> 已订正</label>
      </div>`).join('') || `<div class="empty">该班级暂无学生</div>`;
    }
    function refreshAssigns(className) {
      const list = allAssigns.filter(a => a.className === className).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      assignSel.innerHTML = `<option value="">其他（手动输入）</option>`
        + list.map(a => `<option value="${a.id}">${a.date} · ${escapeHtml((a.content || '').slice(0, 24))}</option>`).join('');
    }
    function applyAssign() {
      const id = +assignSel.value;
      const a = allAssigns.find(x => x.id === id);
      if (a) { contentIn.value = a.content || ''; contentIn.disabled = true; }
      else { contentIn.disabled = false; }
    }
    assignSel.onchange = () => {
      if (!existing) contentIn.value = '';
      applyAssign();
    };
    classSel.onchange = () => {
      render(buildList(classSel.value));
      refreshAssigns(classSel.value);
      if (!existing) { contentIn.value = ''; applyAssign(); }
      else { applyAssign(); }
    };
    refreshAssigns(defaultClass);
    classSel.value = defaultClass;
    render(buildList(defaultClass));
    if (existing) {
      if (existing.assignId) assignSel.value = existing.assignId;
      contentIn.value = existing.content || '';
      applyAssign();
    } else {
      applyAssign();
    }

    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const date = val('cDate'); if (!date) { toast('请选择日期', 'err'); return; }
        const className = val('cClass'); if (!className) { toast('请选择班级', 'err'); return; }
        const assignId = +assignSel.value || null;
        const content = val('cContent'); if (!content) { toast('请填写作业内容', 'err'); return; }
        const formStudents = buildList(className);
        const records = formStudents.map(s => {
          const submitted = box.querySelector(`input[name="sub_${s.id}"]`).checked;
          const corrected = box.querySelector(`input[name="cor_${s.id}"]`).checked;
          return { studentId: s.id, submitted, corrected: submitted ? corrected : false };
        });
        if (existing) {
          await DB.op('homeworkCollect', 'update', { id: existing.id, data: { date, className, assignId, content, records } });
          closeModal(); toast('收缴记录已更新', 'ok'); loadHwCollect();
        } else {
          await DB.op('homeworkCollect', 'create', { data: { date, className, assignId, content, records } });
          closeModal(); toast('收缴已登记', 'ok'); loadHwCollect();
        }
      }
    };
  }

  /* ---------- 学生作业内容管理（教室端展示用） ---------- */
  async function hwWorksManager(stu) {
    const works = (await DB.getAll('homeworkWorks')).filter(w => !App.activeClass() || w.className === App.activeClass()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const body = `
      <div class="between mb16"><span class="muted">共 ${works.length} 份学生作业（用于教室端「作业展示 → 学生作业」）</span>
        <button class="btn btn-primary btn-sm" id="addWkBtn">＋ 添加作业</button></div>
      <div id="wkList"></div>`;
    openModal({
      title: '学生作业管理',
      body,
      foot: `<button class="btn btn-ghost" data-act="close">关闭</button>`
    });
    $('#modalFoot').onclick = e => { if (e.target.dataset.act === 'close') closeModal(); };
    renderWkList(works, stu);
    $('#addWkBtn').onclick = () => wkForm(stu);
  }
  function renderWkList(list, stu) {
    const wrap = $('#wkList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无学生作业，点击右上角添加</div>`; return; }
    wrap.innerHTML = list.map(w => {
      const name = w.studentName || sidName(stu, w.studentId);
      const preview = w.type === 'image'
        ? `<img src="${w.content}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:8px;background:var(--rice-2)">`
        : `<div style="width:54px;height:54px;border-radius:8px;background:var(--rice-2);display:flex;align-items:center;justify-content:center;font-size:22px">📄</div>`;
      return `<div class="list-item">
        ${preview}
        <div style="flex:1;min-width:0">
          <b>${escapeHtml(name)}</b> <span class="tag ${w.type === 'image' ? 'yellow' : 'green'}">${w.type === 'image' ? '图片' : '文字'}</span>
          ${w.className ? `<span class="muted">· ${escapeHtml(w.className)}</span>` : ''}
          ${w.note ? `<div class="muted">${escapeHtml(w.note)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" data-del="${w.id}">删除</button>
      </div>`;
    }).join('');
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除这份学生作业？', { danger: true, okText: '删除' })) {
        await DB.op('homeworkWorks', 'delete', { id });
        toast('已删除', 'ok');
        const wl = (await DB.getAll('homeworkWorks')).filter(w => !App.activeClass() || w.className === App.activeClass()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderWkList(wl, stu);
      }
    });
  }
  function wkForm(stu) {
    openModal({
      title: '添加学生作业',
      body: `
        <div class="form-row"><label>学生</label><select class="input" id="wkStu">${(stu.length ? stu : []).map(s => `<option value="${s.id}">${escapeHtml((s.no || '') + ' ' + s.name)}</option>`).join('') || '<option>请先在花名册添加学生</option>'}</select></div>
        <div class="form-row"><label>类型</label><select class="input" id="wkType">
          <option value="image">图片</option><option value="text">文字</option></select></div>
        <div class="form-row" id="wkImgRow"><label>图片</label><input class="input" id="wkImg" type="file" accept="image/*"></div>
        <div class="form-row" id="wkTextRow" style="display:none"><label>文字内容</label><textarea class="input" id="wkText" placeholder="学生作业文字内容"></textarea></div>
        <div class="form-row"><label>备注（可选）</label><input class="input" id="wkNote" placeholder="如：第三题解答"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    const typeSel = $('#wkType');
    typeSel.onchange = () => {
      $('#wkImgRow').style.display = typeSel.value === 'image' ? '' : 'none';
      $('#wkTextRow').style.display = typeSel.value === 'image' ? 'none' : '';
    };
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') { closeModal(); hwWorksManager(stu); return; }
      if (act === 'ok') {
        const studentId = +val('wkStu');
        const st = stu.find(x => x.id === studentId) || {};
        const type = val('wkType');
        let content = '';
        if (type === 'image') {
          const file = $('#wkImg').files[0];
          if (!file) { toast('请选择图片', 'err'); return; }
          if (file.size > 4 * 1024 * 1024) { toast('图片过大（>4MB），请压缩后上传', 'err'); return; }
          content = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        } else {
          content = val('wkText');
          if (!content) { toast('请填写文字内容', 'err'); return; }
        }
        await DB.op('homeworkWorks', 'create', { data: { studentId, studentName: st.name || '', className: st.className || '', type, content, note: val('wkNote'), createdAt: Date.now() } });
        closeModal(); toast('学生作业已添加', 'ok'); hwWorksManager(stu);
      }
    };
  }

  /* =======================================================
     5. 课堂教学记录
     ======================================================= */
  async function loadTeaching() {
    const list = byClass(await DB.getAll('teachingRecords')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const body = `
      <div class="between mb16"><span class="muted">共 ${list.length} 条教学记录${App.isAll() ? '（全部班级）' : ''}</span><button class="btn btn-primary btn-sm" id="addT">+ 新增记录</button></div>
      <div id="tList"></div>`;
    openDrawer('📖 课堂教学记录', body);
    $('#addT').onclick = () => teachingForm();
    renderTList(list);
  }
  function renderTList(list) {
    const wrap = $('#tList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无教学记录</div>`; return; }
    wrap.innerHTML = list.map(r => `<div class="card mb16" data-id="${r.id}">
      <div class="card-head"><div class="card-title">${r.date} · 第${r.period || 1}节${App.isAll() ? ' · ' + esc(r.className || '') : ''}</div>
        <button class="btn btn-ghost btn-sm" data-del="${r.id}">删除</button></div>
      ${r.progress ? `<p style="margin:4px 0"><b>进度：</b>${escapeHtml(r.progress)}</p>` : ''}
      ${r.keyPoints ? `<p class="muted" style="margin:4px 0"><b>重难点：</b>${escapeHtml(r.keyPoints)}</p>` : ''}
      ${r.adjustment ? `<p class="muted" style="margin:4px 0"><b>调整：</b>${escapeHtml(r.adjustment)}</p>` : ''}
      ${r.studentSituation ? `<p class="muted" style="margin:4px 0"><b>学情：</b>${escapeHtml(r.studentSituation)}</p>` : ''}
    </div>`).join('');
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除该教学记录？', { danger: true, okText: '删除' })) {
        await DB.op('teachingRecords', 'delete', { id }); toast('已删除', 'ok'); loadTeaching();
      }
    });
  }
  function teachingForm() {
    const defaultClass = cls();
    openModal({
      title: '新增教学记录',
      body: `<div class="field-inline">
          <div class="form-row"><label>日期</label><input class="input" id="tDate" type="date" value="${todayStr()}"></div>
          <div class="form-row"><label>节次</label><input class="input" id="tPeriod" type="number" min="1" value="1"></div>
        </div>
        <div class="form-row"><label>班级</label>${classSelectHtml('tClass', defaultClass)}</div>
        <div class="form-row"><label>授课进度</label><input class="input" id="tProgress" placeholder="如：第三单元第2课时"></div>
        <div class="form-row"><label>课堂重难点</label><textarea class="input" id="tKey"></textarea></div>
        <div class="form-row"><label>当堂教学调整备注</label><textarea class="input" id="tAdj"></textarea></div>
        <div class="form-row"><label>学情简要记录</label><textarea class="input" id="tSit"></textarea></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const date = val('tDate'); if (!date) { toast('请选择日期', 'err'); return; }
        const className = val('tClass'); if (!className) { toast('请选择班级', 'err'); return; }
        await DB.op('teachingRecords', 'create', { data: {
          date, period: val('tPeriod') || '1', className,
          progress: val('tProgress'), keyPoints: val('tKey'),
          adjustment: val('tAdj'), studentSituation: val('tSit')
        } });
        closeModal(); toast('教学记录已保存', 'ok'); loadTeaching();
      }
    };
  }

  /* =======================================================
     6. 课堂异常登记
     ======================================================= */
  async function loadAbnormal() {
    const list = byClass(await DB.getAll('abnormalLog')).sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
    const body = `
      <div class="between mb16"><span class="muted">共 ${list.length} 条异常登记${App.isAll() ? '（全部班级）' : ''}</span><button class="btn btn-primary btn-sm" id="addAb">+ 登记异常</button></div>
      <div id="abList"></div>`;
    openDrawer('⚠️ 课堂异常登记', body);
    $('#addAb').onclick = () => abnormalForm();
    renderAbList(list);
  }
  function renderAbList(list) {
    const wrap = $('#abList');
    if (!list.length) { wrap.innerHTML = `<div class="empty">暂无异常登记</div>`; return; }
    wrap.innerHTML = list.map(r => `<div class="card mb16" data-id="${r.id}">
      <div class="card-head"><div class="card-title">${r.datetime || r.date || ''}${App.isAll() ? ' · ' + esc(r.className || '') : ''}</div>
        <button class="btn btn-ghost btn-sm" data-del="${r.id}">删除</button></div>
      ${r.type ? `<p><span class="tag red">${escapeHtml(r.type)}</span></p>` : ''}
      ${r.description ? `<p style="margin:6px 0"><b>情况：</b>${escapeHtml(r.description)}</p>` : ''}
      ${r.handling ? `<p class="muted"><b>处理：</b>${escapeHtml(r.handling)}</p>` : ''}
    </div>`).join('');
    $$('[data-del]', wrap).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      if (await confirmBox('删除该异常登记？', { danger: true, okText: '删除' })) {
        await DB.op('abnormalLog', 'delete', { id }); toast('已删除', 'ok'); loadAbnormal();
      }
    });
  }
  function abnormalForm() {
    const now = new Date(); const dt = `${now.getFullYear()}-${App.pad(now.getMonth() + 1)}-${App.pad(now.getDate())}T${App.pad(now.getHours())}:${App.pad(now.getMinutes())}`;
    const defaultClass = cls();
    openModal({
      title: '登记课堂异常',
      body: `<div class="form-row"><label>时间</label><input class="input" id="abDt" type="datetime-local" value="${dt}"></div>
        <div class="form-row"><label>班级</label>${classSelectHtml('abClass', defaultClass)}</div>
        <div class="form-row"><label>类型</label><select class="input" id="abType">
          <option>课间冲突</option><option>课堂违纪</option><option>设备故障</option>
          <option>学生突发不适</option><option>其它</option></select></div>
        <div class="form-row"><label>情况描述</label><textarea class="input" id="abDesc"></textarea></div>
        <div class="form-row"><label>处理记录</label><textarea class="input" id="abHand"></textarea></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const datetime = val('abDt'); if (!datetime) { toast('请选择时间', 'err'); return; }
        const className = val('abClass'); if (!className) { toast('请选择班级', 'err'); return; }
        await DB.op('abnormalLog', 'create', { data: {
          datetime, className, type: val('abType'),
          description: val('abDesc'), handling: val('abHand')
        } });
        closeModal(); toast('异常已登记', 'ok'); loadAbnormal();
      }
    };
  }

  /* ---------- 暴露 ---------- */
  global.Workbench = { render, summary };

})(window);
