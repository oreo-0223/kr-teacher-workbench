/* ============================================================
   grades.js · 成绩分析
   - 创建考试 -> 录入分数 -> 统计分析（均分/最高/最低/分段/排名）
   - 按当前班级过滤；"全部班级"时提供各班均分/及格率对比表
   ============================================================ */
(function (global) {
  'use strict';
  const { $, $$, toast, openModal, closeModal, confirmBox, val, el, esc } = App;

  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${App.pad(d.getMonth() + 1)}-${App.pad(d.getDate())}`; }
  function escapeHtml(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }
  function statsOf(ex) {
    const nums = (ex.records || []).filter(r => r.score != null && r.score !== '' && !isNaN(+r.score)).map(r => +r.score);
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    const mx = nums.length ? Math.max(...nums) : 0, mn = nums.length ? Math.min(...nums) : 0;
    const pass = nums.filter(n => n >= 60).length;
    return { nums, avg, mx, mn, pass, rate: nums.length ? Math.round(pass / nums.length * 100) : 0 };
  }

  // 多系列折线图配色（与项目浅红/浅黄系一致）
  const PALETTE = ['#C97474', '#D98A3F', '#6FA85A', '#C9A93C', '#7A6B9A', '#5B8FB0', '#B06B9A', '#9CA36A'];

  // CSV 单元格转义（双引号包裹 + 内部双写）
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }

  /* 手绘内联 SVG 折线趋势图卡片
     series: [{ name, color, values:[num|null] }]
     labels: x 轴标签数组 */
  function trendCard(title, series, labels) {
    const allVals = [];
    (series || []).forEach(s => (s.values || []).forEach(v => { if (v != null && !isNaN(+v)) allVals.push(+v); }));
    const W = 680, H = 240, padL = 44, padR = 16, padT = 16, padB = 34;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    let lo = 0, hi = 100;
    if (allVals.length) {
      const mn = Math.min(...allVals), mx = Math.max(...allVals);
      if (mn !== mx) {
        const span = mx - mn;
        lo = Math.max(0, Math.floor((mn - span * 0.15) / 5) * 5);
        hi = Math.ceil((mx + span * 0.15) / 5) * 5;
      } else { lo = Math.max(0, Math.floor(mn) - 5); hi = Math.ceil(mx) + 5; }
      if (hi - lo < 10) hi = lo + 10;
    }
    const n = (labels || []).length;
    const xAt = i => n <= 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1);
    const yAt = v => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

    // y 轴网格 + 刻度
    let grid = '', yTicks = 4;
    for (let t = 0; t <= yTicks; t++) {
      const val = lo + (hi - lo) * t / yTicks, y = +yAt(val).toFixed(1);
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#EADFCE" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#A99C8E">${Math.round(val)}</text>`;
    }
    // x 轴标签
    let xlabel = '';
    (labels || []).forEach((lb, i) => {
      xlabel += `<text x="${xAt(i).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="11" fill="#7A6E62">${escapeHtml(lb || '')}</text>`;
    });
    // 折线 + 数据点
    let paths = '';
    (series || []).forEach(s => {
      const pts = (s.values || []).map((v, i) => (v == null || isNaN(+v)) ? null : { x: +xAt(i).toFixed(1), y: +yAt(+v).toFixed(1) }).filter(Boolean);
      if (!pts.length) return;
      const d = pts.map((p, k) => (k === 0 ? 'M' : 'L') + p.x + ' ' + p.y).join(' ');
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach(p => { paths += `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="#fff" stroke="${s.color}" stroke-width="2"/>`; });
    });
    const svg = `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(title)}">${grid}${xlabel}${paths}</svg>`;
    // 图例（HTML 流式，自动换行）
    const legend = (series || []).map(s => `<span class="trend-leg"><i style="background:${s.color}"></i>${escapeHtml(s.name || '')}</span>`).join('');
    return `<div class="card chart-card mb16">
      <div class="card-head"><div class="card-title">📈 ${escapeHtml(title)}</div></div>
      ${svg}
      <div class="trend-legend">${legend}</div>
    </div>`;
  }

  // 导出成绩 CSV：按当前班级视图导出矩阵；全部班级时导出扁平明细
  async function exportGradesCsv() {
    const all = await DB.getAll('grades');
    if (!all.length) { toast('暂无考试数据', 'err'); return; }
    let csv, fname;
    if (App.isAll()) {
      const head = ['班级', '考试', '日期', '姓名', '分数', '备注'];
      const rows = [];
      for (const ex of all) {
        const stu = await App.studentsOf(ex.className);
        for (const r of (ex.records || [])) {
          rows.push([ex.className, ex.examName, ex.date, stuName(stu, r.studentId),
            (r.score == null || r.score === '') ? '' : r.score, r.note || '']);
        }
      }
      csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
      fname = `成绩_全部班级_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      const cn = App.activeClass();
      const list = all.filter(r => (r.className || '') === cn).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      if (!list.length) { toast('本班暂无考试', 'err'); return; }
      const stu = await App.studentsOf(cn);
      const head = ['学号', '姓名', ...list.map(e => `${e.examName}(${e.date || ''})`)];
      const rows = stu.map(s => {
        const row = [s.no || '', s.name || ''];
        list.forEach(ex => {
          const rec = (ex.records || []).find(r => r.studentId === s.id);
          row.push(rec && rec.score !== '' && rec.score != null ? rec.score : '');
        });
        return row;
      });
      csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
      fname = `成绩_${cn}_${new Date().toISOString().slice(0, 10)}.csv`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    toast('已导出 CSV', 'ok');
  }

  async function render(c) {
    const c0 = App.activeClass();
    const clsText = c0 ? `${c0}（${App.classSubject(c0)}）` : '全部班级';
    c.innerHTML = `
      <div class="between mb16">
        <div><p class="section-title"><span class="bar-accent"></span>成绩分析</p>
        <p class="section-desc">${clsText}</p></div>
        <div class="row" style="gap:8px">
          <button class="btn btn-ghost btn-sm" id="expGrades">⬆ 导出CSV</button>
          <button class="btn btn-primary btn-sm" id="addExam">+ 新建考试</button>
        </div>
      </div>
      <div id="gradeArea"></div>`;
    $('#addExam').onclick = () => examForm();
    $('#expGrades').onclick = () => exportGradesCsv();
    draw();
  }

  async function draw() {
    const all = await DB.getAll('grades');
    const area = $('#gradeArea');
    if (App.isAll()) { renderCompare(area, all); return; }
    const cn = App.activeClass();
    const list = all.filter(r => (r.className || '') === cn).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!list.length) { area.innerHTML = `<div class="empty" style="grid-column:1/-1">本班暂无考试，点击右上角新建</div>`; return; }
    let html = '';
    if (list.length >= 2) {
      const asc = [...list].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const labels = asc.map(ex => (ex.date || '').slice(5) || ex.examName || '');
      const values = asc.map(ex => { const s = statsOf(ex); return s.nums.length ? +s.avg.toFixed(1) : 0; });
      html += trendCard('历次考试均分趋势', [{ name: cn, color: '#C97474', values }], labels);
    }
    html += `<div class="grid cards-2">` + list.map(ex => {
      const s = statsOf(ex);
      return `<div class="card clickable" data-id="${ex.id}">
        <div class="card-head"><div class="card-title">📊 ${escapeHtml(ex.examName || '考试')}</div>
          <span class="tag yellow">${ex.date || ''}</span></div>
        <div class="stat-row">
          <div class="stat"><div class="num">${s.nums.length ? s.avg.toFixed(1) : '—'}</div><div class="lbl">平均分</div></div>
          <div class="stat ok"><div class="num">${s.nums.length ? s.mx : '—'}</div><div class="lbl">最高</div></div>
          <div class="stat warn"><div class="num">${s.nums.length ? s.mn : '—'}</div><div class="lbl">最低</div></div>
          <div class="stat"><div class="num">${s.nums.length ? s.rate + '%' : '—'}</div><div class="lbl">及格率</div></div>
        </div>
        <p class="muted mt8">${(ex.records || []).filter(r => r.score != null && r.score !== '').length} 人有成绩 · 点击查看详情与分析</p>
      </div>`;
    }).join('') + `</div>`;
    area.innerHTML = html;
    $$('[data-id]', area).forEach(card => card.onclick = () => detail(+card.dataset.id));
  }

  // 全部班级：各班均分/及格率对比表
  function renderCompare(area, all) {
    const classes = App.classList();
    if (!classes.length) { area.innerHTML = `<div class="empty">请先在设置中添加班级</div>`; return; }
  const names = [...new Set(all.map(e => e.examName).filter(Boolean))];
  if (!names.length) { area.innerHTML = `<div class="empty">暂无考试数据</div>`; return; }
  const series = classes.map((c, i) => ({
    name: c.name,
    color: PALETTE[i % PALETTE.length],
    values: names.map(nm => {
      const ex = all.find(e => e.examName === nm && (e.className || '') === c.name);
      if (!ex) return null;
      const s = statsOf(ex); return s.nums.length ? +s.avg.toFixed(1) : null;
    })
  }));
  const shortNames = names.map(nm => (nm.length > 6 ? nm.slice(0, 6) + '…' : nm));
  const cols = classes.map(c => `<th>${escapeHtml(c.name)}</th>`).join('');
    const rows = names.map(name => {
      const cells = classes.map(c => {
        const ex = all.find(e => e.examName === name && (e.className || '') === c.name);
        if (!ex) return `<td class="muted">—</td>`;
        const s = statsOf(ex);
        return `<td>${s.nums.length ? s.avg.toFixed(1) + '<br><span class="muted">及格 ' + s.rate + '%</span>' : '无成绩'}</td>`;
      }).join('');
      return `<tr><td><b>${escapeHtml(name)}</b></td>${cells}</tr>`;
    }).join('');
  area.innerHTML = trendCard('各班均分趋势对比', series, shortNames) + `
    <div class="card mb16"><div class="card-head"><div class="card-title">📊 各班均分 / 及格率对比</div></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>考试</th>${cols}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <p class="section-desc mt16">全部考试明细（点击班级筛选查看排名与分段）：</p>
      <div class="grid cards-2" id="allExams"></div>`;
    const exArea = $('#allExams', area);
    exArea.innerHTML = all.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(ex => {
      const s = statsOf(ex);
      return `<div class="card clickable" data-ex="${ex.id}">
        <div class="card-head"><div class="card-title">📊 ${escapeHtml(ex.examName || '考试')}</div><span class="tag yellow">${ex.date || ''}</span></div>
        <p class="muted">${escapeHtml(ex.className || '')} · 均分 ${s.nums.length ? s.avg.toFixed(1) : '—'} · 及格 ${s.nums.length ? s.rate + '%' : '—'}</p>
        <p class="muted mt8">${(ex.records || []).filter(r => r.score != null && r.score !== '').length} 人有成绩 · 点击查看详情与分析</p>
      </div>`;
    }).join('');
    $$('[data-ex]', exArea).forEach(card => card.onclick = () => detail(+card.dataset.ex));
  }

  async function detail(id) {
    const ex = await DB.get('grades', id);
    const stu = await App.studentsOf(ex.className);
    const s = statsOf(ex);
    const recs = ex.records || [];
    const segs = [[90, 100, '优秀', 'green'], [80, 89, '良好', 'green'], [70, 79, '中等', 'yellow'], [60, 69, '及格', 'orange'], [0, 59, '不及格', 'red']];
    const segCount = segs.map(([lo, hi]) => s.nums.filter(n => n >= lo && n <= hi).length);
    const maxSeg = Math.max(1, ...segCount);
    const ranked = recs.map(r => ({ name: stuName(stu, r.studentId), score: r.score === '' || r.score == null ? null : +r.score, note: r.note }))
      .filter(r => r.score != null && !isNaN(r.score))
      .sort((a, b) => b.score - a.score);
    const body = `
      <div class="between mb16">
        <div><b>${escapeHtml(ex.examName)}</b><span class="muted"> · ${ex.date} · ${escapeHtml(ex.className || '')}</span></div>
        <button class="btn btn-soft btn-sm" id="editScores">录入/修改分数</button>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="num">${s.nums.length ? s.avg.toFixed(1) : '—'}</div><div class="lbl">平均分</div></div>
        <div class="stat ok"><div class="num">${s.nums.length ? s.mx : '—'}</div><div class="lbl">最高</div></div>
        <div class="stat warn"><div class="num">${s.nums.length ? s.mn : '—'}</div><div class="lbl">最低</div></div>
        <div class="stat"><div class="num">${s.nums.length ? s.rate + '%' : '—'}</div><div class="lbl">及格率</div></div>
      </div>
      <div class="chart-box mt16">
        <div class="card-title mb8">📈 分数段分布</div>
        ${segs.map((sg, i) => `<div class="row mb8" style="align-items:center">
          <span class="tag ${sg[3]}" style="width:64px;text-align:center">${sg[2]}</span>
          <span class="muted nowrap" style="width:50px">${sg[0]}-${sg[1]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${segCount[i] / maxSeg * 100}%"></div></div>
          <b style="width:30px;text-align:right">${segCount[i]}</b>
        </div>`).join('')}
      </div>
      <div class="chart-box mt16">
        <div class="card-title mb8">🏆 成绩排名</div>
        <div class="table-wrap"><table class="data"><thead><tr><th>名次</th><th>姓名</th><th>分数</th><th>备注</th></tr></thead>
        <tbody>${ranked.length ? ranked.map((r, i) => `<tr><td>${i + 1}</td><td><b>${escapeHtml(r.name)}</b></td><td>${r.score}</td><td class="muted">${escapeHtml(r.note || '')}</td></tr>`).join('') : `<tr><td colspan="4"><div class="empty">暂无成绩</div></td></tr>`}</tbody></table></div>
      </div>`;
    App.openDrawer('📊 成绩详情', body);
    $('#editScores').onclick = () => scoreForm(ex, stu);
  }

  function stuName(list, id) { const s = list.find(x => x.id === id); return s ? s.name : '已删除学生'; }

  async function examForm() {
    openModal({
      title: '新建考试',
      body: `<div class="field-inline">
          <div class="form-row"><label>考试名称</label><input class="input" id="gName" placeholder="如：第一单元测试"></div>
          <div class="form-row"><label>日期</label><input class="input" id="gDate" type="date" value="${todayStr()}"></div>
        </div>
        <div class="form-row"><label>班级</label><select class="input" id="gClass">${App.classList().map(c => `<option value="${esc(c.name)}" ${c.name === (App.activeClass() || '') ? 'selected' : ''}>${esc(c.name)}（${esc(c.subject || '')}）</option>`).join('')}</select></div>
        <div class="form-row"><label>满分（用于参考）</label><input class="input" id="gFull" type="number" value="100"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">创建并录入</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const name = val('gName'); if (!name) { toast('请输入考试名称', 'err'); return; }
        const className = val('gClass'); if (!className) { toast('请选择班级', 'err'); return; }
        const res = await DB.op('grades', 'create', { data: { examName: name, date: val('gDate'), className, fullScore: val('gFull'), records: [] } });
        closeModal(); toast('已创建，请录入分数', 'ok');
        const ex = await DB.get('grades', res.id); const stu = await App.studentsOf(className);
        scoreForm(ex, stu);
      }
    };
  }

  function scoreForm(ex, stu) {
    const map = {}; (ex.records || []).forEach(r => map[r.studentId] = { score: r.score, note: r.note });
    openModal({
      title: `录入分数 · ${ex.examName}`,
      body: `<p class="muted mb8">班级：${escapeHtml(ex.className || '')}。留空表示缺考。修改后保存会自动登记日志，可在操作日志回滚。</p>
        <div id="gRows"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>`
    });
    const box = $('#gRows');
    box.innerHTML = (stu.length ? stu : []).map(s => {
      const cur = map[s.id] || {};
      return `<div class="row list-item">
        <span class="li-name nowrap" style="min-width:80px">${s.no || ''} ${s.name}</span>
        <input class="input" name="sc_${s.id}" type="number" min="0" value="${cur.score != null ? cur.score : ''}" placeholder="分数" style="width:110px;margin:0 8px 0 auto">
        <input class="input" name="nt_${s.id}" value="${escapeHtml(cur.note || '')}" placeholder="备注" style="flex:1;min-width:100px;margin:0">
      </div>`;
    }).join('') || `<div class="empty">本班暂无学生</div>`;
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const records = stu.map(s => ({
          studentId: s.id,
          score: box.querySelector(`input[name="sc_${s.id}"]`).value,
          note: box.querySelector(`input[name="nt_${s.id}"]`).value.trim()
        }));
        await DB.op('grades', 'update', { id: ex.id, data: { records } });
        closeModal(); toast('成绩已保存', 'ok'); draw();
      }
    };
  }

  global.Grades = { render };
})(window);
