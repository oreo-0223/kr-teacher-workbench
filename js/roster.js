/* ============================================================
   roster.js · 花名册 + 班级管理
   - 顶部：班级卡片管理（添加/编辑/删除/切换）
   - 下方：学生增删改查（学号/姓名/性别/备注/班级）
   一个老师可管理多个班级，点击卡片快速切换
   ============================================================ */
(function (global) {
  'use strict';
  const { $, $$, toast, openModal, closeModal, confirmBox, val, el, esc } = App;

  async function render(c) {
    const c0 = App.activeClass();
    const clsText = c0 ? `${c0}（${App.classSubject(c0)}）` : '全部班级';
    c.innerHTML = `
      <div class="between mb16">
        <div><p class="section-title"><span class="bar-accent"></span>花名册</p>
        <p class="section-desc">${clsText} · ${App.isAll() ? '管理班级与学生' : '任教科目：' + App.classSubject(c0)}</p></div>
        <div class="row" style="gap:8px">
          <button class="btn btn-ghost btn-sm" id="impCsv">⬇ 导入</button>
          <button class="btn btn-ghost btn-sm" id="expCsv">⬆ 导出CSV</button>
          <button class="btn btn-primary btn-sm" id="addStu">+ 添加学生</button>
        </div>
      </div>
      <div id="classSection"></div>
      <div class="table-wrap mt16"><table class="data" id="stuTable"></table></div>`;
    $('#addStu').onclick = () => form();
    $('#impCsv').onclick = () => importCsv();
    $('#expCsv').onclick = () => exportCsv();
    drawClasses();
    draw();
  }

  /* ---------- 班级管理卡片 ---------- */
  async function drawClasses() {
    const wrap = $('#classSection');
    if (!wrap) return;
    const classes = App.classList();
    const c0 = App.activeClass();
    const allStu = await DB.getAll('students');
    const countOf = (name) => allStu.filter(s => s.className === name).length;

    let html = `<div class="between mb8"><b>📚 班级管理</b><div class="row" style="gap:8px">
      <button class="btn btn-ghost btn-sm" id="reconcileBtn" title="按现有学生的班级字段，自动补齐缺失的班级卡片">🔄 修复归类</button>
      <button class="btn btn-ghost btn-sm" id="addClassBtn">＋ 添加班级</button>
    </div></div>`;
    html += `<div class="class-cards">`;

    // 全部班级卡片
    html += `<div class="class-card ${App.isAll() ? 'active' : ''}" data-class="__all__">
      <div class="class-card-icon">📋</div>
      <div class="class-card-body">
        <div class="class-card-name">全部班级</div>
        <div class="class-card-meta">${allStu.length} 名学生 · ${classes.length} 个班级</div>
      </div>
    </div>`;

    // 各班卡片
    for (const cl of classes) {
      const cnt = countOf(cl.name);
      html += `<div class="class-card ${c0 === cl.name ? 'active' : ''}" data-class="${esc(cl.name)}">
        <div class="class-card-icon">📘</div>
        <div class="class-card-body">
          <div class="class-card-name">${esc(cl.name)}</div>
          <div class="class-card-meta">${esc(cl.subject || '未设科目')} · ${cnt} 人</div>
        </div>
        <div class="class-card-ops">
          <button class="btn btn-ghost btn-xs" data-cedit="${esc(cl.name)}" title="编辑">✏</button>
          <button class="btn btn-ghost btn-xs" data-cdel="${esc(cl.name)}" title="删除">✕</button>
        </div>
      </div>`;
    }

    // 添加班级占位卡片
    html += `<div class="class-card add-card" id="addClassCard">
      <div class="class-card-icon">＋</div>
      <div class="class-card-body"><div class="class-card-name">添加班级</div></div>
    </div>`;

    html += `</div>`;
    wrap.innerHTML = html;

    // 点击切换班级
    $$('.class-card[data-class]', wrap).forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('[data-cedit]') || e.target.closest('[data-cdel]')) return;
        App.setActiveClass(card.dataset.class);
      };
    });

    // 修复归类：按现有学生 className 批量补齐缺失班级
    $('#reconcileBtn').onclick = async () => {
      try {
        const r = await App.reconcileClasses();
        const msg = r.created.length
          ? `已补齐 ${r.created.length} 个班级：${r.created.join('、')}`
          : '班级已完整，无需补齐';
        toast(msg, 'ok');
        await App.refreshMeta();
        App.updateTopbar();
        render($('#content'));
      } catch (err) {
        toast(err.message || '归类失败', 'err');
      }
    };
    // 添加班级按钮 & 卡片
    $('#addClassBtn').onclick = () => classForm();
    $('#addClassCard').onclick = () => classForm();

    // 编辑
    $$('[data-cedit]', wrap).forEach(b => b.onclick = (e) => { e.stopPropagation(); classForm(b.dataset.cedit); });
    // 删除
    $$('[data-cdel]', wrap).forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await handleDeleteClass(b.dataset.cdel);
    });
  }

  /* ---------- 添加/编辑班级表单 ---------- */
  function classForm(existingName) {
    let cur = null;
    if (existingName) cur = App.classList().find(c => c.name === existingName);

    openModal({
      title: existingName ? '编辑班级' : '添加班级',
      body: `<div class="form-row"><label>班级名称</label><input class="input" id="clsName" value="${esc(existingName || '')}" placeholder="如 三年级2班"></div>
        <div class="form-row"><label>任教科目</label><input class="input" id="clsSubject" value="${esc(cur ? cur.subject || '' : '')}" placeholder="如 科学"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });

    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const name = val('clsName');
        const subject = val('clsSubject');
        if (!name) { toast('请填写班级名称', 'err'); return; }
        try {
          if (existingName) {
            await App.editClass(existingName, name, subject);
            toast('班级已更新', 'ok');
          } else {
            await App.addClass(name, subject);
            toast('班级已添加', 'ok');
          }
          closeModal();
          await App.refreshMeta();
          App.updateTopbar();
          render($('#content'));
        } catch (err) {
          toast(err.message || '操作失败', 'err');
        }
      }
    };
  }

  /* ---------- 删除班级 ---------- */
  async function handleDeleteClass(name) {
    const allStu = await DB.getAll('students');
    const cnt = allStu.filter(s => s.className === name).length;
    const msg = cnt > 0
      ? `删除班级「${name}」？该班有 ${cnt} 名学生。相关考勤/作业/成绩等记录将保留但不再显示，教室账号绑定将被清空。`
      : `删除班级「${name}」？相关记录将保留但不再显示，教室账号绑定将被清空。`;
    if (!(await confirmBox(msg, { danger: true, okText: '删除' }))) return;
    try {
      await App.deleteClass(name);
      toast('班级已删除', 'ok');
      await App.refreshMeta();
      App.updateTopbar();
      render($('#content'));
    } catch (err) {
      toast(err.message || '删除失败', 'err');
    }
  }

  /* ---------- 学生列表 ---------- */
  async function draw() {
    const list = await App.studentsOf(App.activeClass());
    const t = $('#stuTable');
    if (!t) return;
    if (!list.length) {
      const hint = App.isAll() ? '暂无学生，添加学生时请选择班级' : '本班暂无学生，点击右上角添加';
      t.innerHTML = `<tr><td><div class="empty">${hint}</div></td></tr>`;
      return;
    }
    const showClass = App.isAll();
    t.innerHTML = `<thead><tr><th>学号</th><th>姓名</th><th>性别</th>${showClass ? '<th>班级</th>' : ''}<th>备注</th><th style="width:120px">操作</th></tr></thead>
      <tbody>${list.map(s => `<tr>
        <td>${escapeHtml(s.no || '')}</td>
        <td><b>${escapeHtml(s.name || '')}</b></td>
        <td>${escapeHtml(s.gender || '')}</td>
        ${showClass ? `<td class="muted">${escapeHtml(s.className || '')}</td>` : ''}
        <td class="muted">${escapeHtml(s.note || '')}</td>
        <td><button class="btn btn-ghost btn-sm" data-edit="${s.id}">编辑</button> <button class="btn btn-danger btn-sm" data-del="${s.id}">删除</button></td>
      </tr>`).join('')}</tbody>`;
    $$('[data-edit]', t).forEach(b => b.onclick = () => form(+b.dataset.edit));
    $$('[data-del]', t).forEach(b => b.onclick = async () => {
      const id = +b.dataset.del;
      const s = list.find(x => x.id === id);
      if (await confirmBox(`删除学生「${s.name}」？相关考勤/作业等记录中的引用将显示为"已删除学生"。`, { danger: true, okText: '删除' })) {
        await DB.op('students', 'delete', { id }); toast('已删除', 'ok'); draw();
      }
    });
  }

  /* ---------- 添加/编辑学生表单 ---------- */
  async function form(id) {
    let s = {};
    if (id) s = await DB.get('students', id);
    const c0 = App.activeClass();
    const classOpts = App.classList().map(c => `<option value="${esc(c.name)}" ${(!id && !s.className && c.name === c0) || s.className === c.name ? 'selected' : ''}>${esc(c.name)}（${esc(c.subject || '')}）</option>`).join('')
      || `<option value="">（请先添加班级）</option>`;
    openModal({
      title: id ? '编辑学生' : '添加学生',
      body: `<div class="field-inline">
          <div class="form-row"><label>学号</label><input class="input" id="rNo" value="${escapeHtml(s.no || '')}"></div>
          <div class="form-row"><label>姓名</label><input class="input" id="rName" value="${escapeHtml(s.name || '')}"></div>
        </div>
        <div class="form-row"><label>性别</label><select class="input" id="rGender">
          <option value="" ${!s.gender ? 'selected' : ''}>（未填）</option>
          <option value="男" ${s.gender === '男' ? 'selected' : ''}>男</option>
          <option value="女" ${s.gender === '女' ? 'selected' : ''}>女</option>
        </select></div>
        <div class="form-row"><label>所属班级</label><select class="input" id="rClass">${classOpts}</select></div>
        <div class="form-row"><label>备注</label><input class="input" id="rNote" value="${escapeHtml(s.note || '')}" placeholder="如：课代表/需关注"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const name = val('rName'); if (!name) { toast('请输入姓名', 'err'); return; }
        const className = val('rClass'); if (!className) { toast('请选择班级', 'err'); return; }
        const data = { no: val('rNo'), name, gender: val('rGender'), note: val('rNote'), className };
        if (id) await DB.op('students', 'update', { id, data });
        else await DB.op('students', 'create', { data });
        closeModal(); toast('已保存', 'ok'); draw();
      }
    };
  }

  function escapeHtml(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }

  /* ---------- CSV 批量导入 / 导出 ---------- */
  function parseCsvLine(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  async function importCsv() {
    const defClass = App.isAll() ? (App.classList()[0] && App.classList()[0].name) : App.activeClass();
    let xlsxRows = null;
    openModal({
      title: '批量导入学生（CSV / Excel）',
      body: `
        <p class="muted mb8">每行一条，列用逗号分隔（CSV）或直接上传 Excel（.xlsx）。表头可选（含"姓名"或"学号"会自动跳过）。<br>列顺序：<b>学号, 姓名, 性别, 班级, 备注</b></p>
        <p class="muted mb8">未填班级的归入当前班级（${escapeHtml(defClass || '—')}）；全部班级模式下请在文件中提供"班级"列。</p>
        <div class="form-row"><label>选择文件（.csv / .xlsx）</label><input class="input" id="csvFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
        <div class="form-row"><label>或直接粘贴 CSV 内容</label><textarea class="input" id="csvText" placeholder="01,张三,男,三年级2班&#10;02,李四,女,三年级2班" style="min-height:120px"></textarea></div>
        <div id="csvPreview" class="muted"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">导入</button>`
    });
    const fileInput = $('#csvFile');
    const textInput = $('#csvText');
    function previewCsv(txt) {
      const rows = (txt || '').split(/\r?\n/).map(parseCsvLine).filter(r => r.length && r.some(x => (x || '').trim() !== ''));
      $('#csvPreview').textContent = rows.length ? `已识别 ${rows.length} 行` : '';
    }
    fileInput.onchange = async () => {
      const f = fileInput.files[0];
      if (!f) return;
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.xlsx')) {
        try {
          xlsxRows = await parseXlsx(await f.arrayBuffer());
          textInput.value = '';
          $('#csvPreview').textContent = `已识别 ${xlsxRows.length} 行（Excel）`;
        } catch (e) {
          xlsxRows = null;
          toast('Excel 解析失败：' + (e && e.message ? e.message : e), 'err');
        }
      } else {
        xlsxRows = null;
        textInput.value = await f.text();
        previewCsv(textInput.value);
      }
    };
    textInput.oninput = () => { xlsxRows = null; previewCsv(textInput.value); };
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') { closeModal(); return; }
      if (act === 'ok') {
        let rawRows;
        if (xlsxRows) {
          rawRows = xlsxRows;
        } else {
          const txt = textInput.value.trim();
          if (!txt) { toast('请选择文件或粘贴内容', 'err'); return; }
          rawRows = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(parseCsvLine);
        }
        const filtered = rawRows.filter(r => r.length && r.some(x => (x || '').trim() !== ''));
        let rows = filtered;
        if (rows.length && /姓名|学号/.test(rows[0].join(','))) rows = rows.slice(1);
        if (!defClass && rows.some(r => !r[3])) { toast('全部班级模式下，请在文件中提供"班级"列', 'err'); return; }
        // 收集本批涉及的班级，逐一确保存在（不存在则自动建班，同名不重复创建）
        const needClasses = new Set();
        for (const r of rows) {
          const c = ((r[3] || '').trim() || defClass || '').trim();
          if (c) needClasses.add(c);
        }
        for (const c of needClasses) {
          try { await App.ensureClass(c); } catch (_) { /* 已存在等情况忽略 */ }
        }
        let ok = 0, skip = 0;
        for (const r of rows) {
          const [no, name, gender, className, note] = r;
          if (!name) { skip++; continue; }
          const cls = (className || '').trim() || defClass;
          await DB.op('students', 'create', { data: { no: (no || '').trim(), name: name.trim(), gender: (gender || '').trim(), className: cls, note: (note || '').trim() } });
          ok++;
        }
        closeModal();
        toast(`已导入 ${ok} 人${skip ? '，跳过 ' + skip + ' 行（缺姓名）' : ''}`, ok ? 'ok' : 'err');
        await App.refreshMeta();
        App.updateTopbar();
        render($('#content'));
      }
    };
  }

  async function exportCsv() {
    const list = await App.studentsOf(App.activeClass());
    const head = '学号,姓名,性别,班级,备注';
    const lines = list.map(s => [s.no || '', s.name || '', s.gender || '', s.className || '', s.note || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = '﻿' + [head, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `学生花名册_${App.activeClass() || '全部'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('已导出 CSV', 'ok');
  }

  global.Roster = { render };
})(window);
