/* ============================================================
   schedule.js · 课程表
   周一至周五；每天结构含上课节次 + 非上课时段条（船寮高级中学夏季作息）
   老师账号（全部班级）合并为一张表，每格可含多个班级课程
   左侧时段配置可点击编辑（名称 / 时间 / 类型 / 编号），保存到 localStorage('tt.slots')
   ============================================================ */
(function (global) {
  'use strict';
  const { $, $$, toast, openModal, closeModal, confirmBox, val, el, esc } = App;

  const DAYS = ['周一', '周二', '周三', '周四', '周五'];

  // 默认时段（按船寮高级中学夏季作息时间表）
  // id 字段仅用于编辑定位，不会影响已有数据；p 字段与排课记录里的 period 关联
  // 上课节次 period 0=早读, 1-4=上午, 5-8=下午, 9=晚读, 10/11=晚自修(1)/(2)
  // 非上课时段用 101+ 编号，绝不会和上课节次冲突
  const DEFAULT_SLOTS = [
    { id: 'zaodu',  p: 0,   label: '早读',     time: '6:40-7:20',   type: 'class' },
    { id: 'j1',     p: 1,   label: '第一节',   time: '7:40-8:25',   type: 'class' },
    { id: 'j2',     p: 2,   label: '第二节',   time: '8:35-9:20',   type: 'class' },
    { id: 'j3',     p: 3,   label: '第三节',   time: '9:50-10:35',  type: 'class' },
    { id: 'j4',     p: 4,   label: '第四节',   time: '10:45-11:30', type: 'class' },
    { id: 'wuxiu',  p: 102, label: '午休',     time: '12:30-13:35', type: 'break' },
    { id: 'j5',     p: 5,   label: '第五节',   time: '13:20-14:05', type: 'class' },
    { id: 'j6',     p: 6,   label: '第六节',   time: '14:15-15:00', type: 'class' },
    { id: 'j7',     p: 7,   label: '第七节',   time: '15:25-16:10', type: 'class' },
    { id: 'j8',     p: 8,   label: '第八节',   time: '16:20-17:05', type: 'class' },
    { id: 'wanfan', p: 107, label: '晚饭',     time: '17:30-18:10', type: 'break' },
    { id: 'w1',     p: 9,   label: '晚读',     time: '18:20-19:00', type: 'class' },
    { id: 'w2',     p: 10,  label: '晚一',     time: '19:10-20:05', type: 'class' },
    { id: 'w3',     p: 11,  label: '晚二',     time: '20:30-21:20', type: 'class' },
  ];

  // 时段配置统一存到数据库的 meta.slots（全校共享、跨设备、跨账号）
  let SLOTS = [];

  // 已从默认配置下线的时段 id（迁移时自动剔除，无需手动清理）
  const REMOVED_SLOT_IDS = new Set(['eyebc1', 'eyebc2']);

  // 优先读数据库（全校共享）；首次访问时把旧 localStorage 数据迁移进库后清掉本地副本
  async function loadSlots() {
    // 1) 数据库 meta.slots（权威源）
    try {
      const meta = await DB.getMeta();
      if (meta && Array.isArray(meta.slots) && meta.slots.length) {
        return meta.slots.filter(s => !REMOVED_SLOT_IDS.has(s.id));
      }
    } catch (e) {}
    // 2) 兜底：本地 localStorage 迁移进库（仅首次，剔除已下线项）
    try {
      const raw = localStorage.getItem('tt.slots');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          const filtered = arr.filter(s => !REMOVED_SLOT_IDS.has(s.id));
          try { localStorage.removeItem('tt.slots'); } catch (e) {}
          try { await DB.setMeta({ slots: filtered }); } catch (e) {}
          return filtered;
        }
      }
    } catch (e) {}
    // 3) 都没有：写入默认值
    try { await DB.setMeta({ slots: DEFAULT_SLOTS }); } catch (e) {}
    return DEFAULT_SLOTS.slice();
  }
  async function saveSlots() {
    try { await DB.setMeta({ slots: SLOTS }); }
    catch (e) { toast('保存失败：无法写入服务器，请检查网络', 'err'); }
  }
  function slotById(id) { return SLOTS.find(x => x.id === id); }
  function slotByP(p)   { return SLOTS.find(x => x.p === p); }
  function slotLabel(p) { const s = slotByP(p); return s ? s.label : ('时段' + p); }
  function slotTime(p)  { const s = slotByP(p); return s ? s.time  : ''; }
  function slotFull(p)  { const s = slotByP(p); return s ? (s.label + ' ' + s.time) : ('时段' + p); }

  function escapeHtml(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }
  function classSelectHtml(id, selected) {
    return `<select class="input" id="${id}">${App.classList().map(c => `<option value="${esc(c.name)}" ${c.name === selected ? 'selected' : ''}>${esc(c.name)}${c.subject ? '（' + esc(c.subject) + '）' : ''}</option>`).join('')}</select>`;
  }

  async function render(c) {
    SLOTS = await loadSlots();
    c.innerHTML = `
      <p class="section-title"><span class="bar-accent"></span>课程表</p>
      <p class="section-desc">时段按船寮高级中学夏季作息时间表（执行时间 5.1-9.30）。<b>点击左侧时段</b>可改名称、时间、类型；休息时段（灰条）不可排课。${App.isAll()
        ? '已合并所有班级的课表，点击单元格可管理该时段课程（同一时段可含多个班级）。'
        : '当前班级：' + (App.activeClass() + '（' + App.classSubject(App.activeClass()) + '）') + ' · 点击单元格设置课程。'}</p>
      <div class="tt-toolbar">
        <button class="btn btn-soft btn-xs" id="ttAddRow">＋ 新增时段</button>
        <button class="btn btn-ghost btn-xs" id="ttReset">恢复默认时段</button>
        <span class="tt-toolbar-tip">时段已存到服务器，全校账号共享、换设备不丢失</span>
      </div>
      <div id="ttWrap" class="mt8"></div>`;
    draw();
    $('#ttReset') && ($('#ttReset').onclick = async () => {
      if (await confirmBox('恢复为默认时段？\n现有排课记录中，已删除/新增时段的排课可能无法显示。', { okText: '恢复默认' })) {
        SLOTS = DEFAULT_SLOTS.slice();
        await saveSlots();
        toast('已恢复默认时段', 'ok');
        draw();
      }
    });
    $('#ttAddRow') && ($('#ttAddRow').onclick = () => addSlotModal());
  }

  async function draw() {
    const all = await DB.getAll('schedule');
    const wrap = $('#ttWrap');
    if (!wrap) return;
    if (App.isAll()) {
      wrap.innerHTML = gridHtml(all, '', true);
      $$('td[data-merged]', wrap).forEach(td => td.onclick = () => mergedCellModal(+td.dataset.day, +td.dataset.period));
    } else {
      const className = App.activeClass();
      if (!className) { wrap.innerHTML = `<div class="empty">请选择班级</div>`; return; }
      wrap.innerHTML = gridHtml(all, className, false);
      $$('td[data-day]', wrap).forEach(td => td.onclick = () => cellClick(+td.dataset.day, +td.dataset.period, td.dataset.cls));
    }
    $$('td.tt-slot-cell', wrap).forEach(td => td.onclick = () => slotEditModal(td.dataset.slotId));
  }

  function gridHtml(all, className, merged) {
    let head = `<tr><th style="min-width:92px">时段</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr>`;
    let rows = '';
    for (const slot of SLOTS) {
      if (slot.type === 'break') {
        rows += `<tr><td class="tt-break" colspan="6"><span class="tt-break-badge">${escapeHtml(slot.label)}</span><span class="tt-break-time">${escapeHtml(slot.time)}</span></td></tr>`;
        continue;
      }
      rows += `<tr><td class="tt-slot-cell" data-slot-id="${slot.id}" title="点击编辑：名称 / 时间 / 类型">
        <div class="tt-slot-label">${escapeHtml(slot.label)}</div>
        <div class="tt-slot-time">${escapeHtml(slot.time)}</div>
      </td>`;
      for (let d = 1; d <= DAYS.length; d++) {
        const recs = all.filter(x => x.day === d && x.period === slot.p && (merged || (x.className || '') === className));
        if (merged) {
          rows += `<td data-day="${d}" data-period="${slot.p}" data-merged="1">${recs.length ? recs.map(r => `<div class="tt-cell-item">${cellHtml(r)}</div>`).join('') : `<span class="muted">＋</span>`}</td>`;
        } else {
          const cell = recs[0];
          rows += `<td data-day="${d}" data-period="${slot.p}" data-cls="${esc(className)}">${cell ? cellHtml(cell) : `<span class="muted">＋</span>`}</td>`;
        }
      }
      rows += '</tr>';
    }
    return `<div class="table-wrap"><table class="tt-table">${head + rows}</table></div>`;
  }

  function cellHtml(c) {
    return `<div class="tt-cell">${escapeHtml(c.subject || '')}</div>${c.className ? `<div class="tt-cls-tag">${escapeHtml(c.className)}</div>` : ''}${c.note ? `<div class="cls">${escapeHtml(c.note)}</div>` : ''}`;
  }

  /* 新增时段（插到末尾） */
  async function addSlotModal() {
    openModal({
      title: '新增时段',
      body: `<div class="form-row"><label>名称</label><input class="input" id="nsLabel" placeholder="如 第九节" maxlength="14"></div>
        <div class="form-row"><label>时间</label><input class="input" id="nsTime" placeholder="如 7:00-7:45" maxlength="20"></div>
        <div class="form-row"><label>类型</label>
          <select class="input" id="nsType">
            <option value="class">上课节次（可排课）</option>
            <option value="break">非上课时段（跨整行显示）</option>
          </select>
        </div>
        <div class="form-row"><label>时段编号</label><input class="input" id="nsP" type="number" value="12" min="0" max="999"></div>
        <div class="hint">系统会自动避开冲突的编号；编号与排课记录里的 period 关联，修改后该时段上的现有排课将丢失。</div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">取消</button>
             <button class="btn btn-primary" data-act="ok">添加</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'ok') {
        const label = val('nsLabel').trim();
        const time  = val('nsTime').trim();
        const type  = val('nsType');
        const p     = parseInt(val('nsP'), 10);
        if (!label) { toast('请填写名称', 'err'); return; }
        if (!time)  { toast('请填写时间', 'err'); return; }
        if (Number.isNaN(p)) { toast('时段编号需为数字', 'err'); return; }
        if (SLOTS.some(s => s.p === p)) {
          toast(`时段编号 ${p} 已被占用，请换一个`, 'err'); return;
        }
        const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        SLOTS.push({ id, p, label, time, type });
        await saveSlots();
        closeModal(); toast('已添加', 'ok'); draw();
      }
    };
  }

  /* 编辑时段 */
  async function slotEditModal(slotId) {
    const slot = slotById(slotId);
    if (!slot) return;
    openModal({
      title: `编辑时段：${slot.label}`,
      body: `<div class="form-row"><label>名称</label><input class="input" id="sLbl" value="${escapeHtml(slot.label)}" maxlength="14"></div>
        <div class="form-row"><label>时间</label><input class="input" id="sTm" value="${escapeHtml(slot.time)}" placeholder="如 7:40-8:25" maxlength="20"></div>
        <div class="form-row"><label>类型</label>
          <select class="input" id="sTy">
            <option value="class" ${slot.type === 'class' ? 'selected' : ''}>上课节次（可排课）</option>
            <option value="break" ${slot.type === 'break' ? 'selected' : ''}>非上课时段（不可排课，跨整行显示）</option>
          </select>
        </div>
        <div class="form-row"><label>时段编号</label><input class="input" id="sP" type="number" value="${slot.p}" min="0" max="999">
          <div class="hint">用于与排课记录关联；可在 0-999 之间修改，编号冲突时会提示。修改后原时段上的排课将不再显示。</div>
        </div>`,
      foot: `<button class="btn btn-soft" data-act="reset" style="margin-right:auto">恢复默认</button>
             <button class="btn btn-danger" data-act="del">删除</button>
             <button class="btn btn-ghost" data-act="cancel">取消</button>
             <button class="btn btn-primary" data-act="ok">保存</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'del') {
        if (await confirmBox(`删除时段「${slot.label}」？该时段上的排课也会被一并清除（不可恢复）。`, { danger: true, okText: '删除' })) {
          const p = slot.p;
          SLOTS = SLOTS.filter(s => s.id !== slotId);
          await saveSlots();
          const all = await DB.getAll('schedule');
          for (const rec of all.filter(r => r.period === p)) {
            await DB.op('schedule', 'delete', { id: rec.id });
          }
          closeModal(); toast('已删除', 'ok'); draw();
        }
      }
      if (act === 'reset') {
        const def = DEFAULT_SLOTS.find(s => s.id === slotId);
        if (def) {
          const i = SLOTS.findIndex(s => s.id === slotId);
          SLOTS[i] = Object.assign({}, def);
          await saveSlots();
          closeModal(); toast('已重置', 'ok'); draw();
        } else {
          toast('该时段不在默认配置中', 'err');
        }
      }
      if (act === 'ok') {
        const newLabel = val('sLbl').trim();
        const newTime  = val('sTm').trim();
        const newType  = val('sTy');
        const newP     = parseInt(val('sP'), 10);
        if (!newLabel) { toast('请填写名称', 'err'); return; }
        if (!newTime)  { toast('请填写时间', 'err'); return; }
        if (Number.isNaN(newP)) { toast('时段编号需为数字', 'err'); return; }
        const conflict = SLOTS.find(s => s.id !== slotId && s.p === newP);
        if (conflict) { toast(`时段编号 ${newP} 已被「${conflict.label}」占用，请换一个`, 'err'); return; }
        const i = SLOTS.findIndex(s => s.id === slotId);
        const oldP = SLOTS[i].p;
        SLOTS[i].label = newLabel;
        SLOTS[i].time  = newTime;
        SLOTS[i].type  = newType;
        SLOTS[i].p     = newP;
        await saveSlots();
        if (oldP !== newP) {
          const all = await DB.getAll('schedule');
          for (const rec of all.filter(r => r.period === oldP)) {
            await DB.op('schedule', 'update', { id: rec.id, data: Object.assign({}, rec, { period: newP }) });
          }
        }
        closeModal(); toast('已保存', 'ok'); draw();
      }
    };
  }

  /* 单班级单元格：新建或编辑 */
  async function cellClick(day, period, className) {
    const all = await DB.getAll('schedule');
    const cell = all.find(x => x.day === day && x.period === period && (x.className || '') === className);
    openModal({
      title: `${DAYS[day - 1]} · ${slotLabel(period)} <span class="tt-modal-time">${slotTime(period)}</span>`,
      body: `<div class="form-row"><label>科目</label><input class="input" id="sSub" value="${cell ? escapeHtml(cell.subject || '') : ''}"></div>
        <div class="form-row"><label>班级</label>${classSelectHtml('sCls', cell ? (cell.className || className) : className)}</div>
        <div class="form-row"><label>备注（如实验室/教室）</label><input class="input" id="sNote" value="${cell ? escapeHtml(cell.note || '') : ''}"></div>`,
      foot: `
        ${cell ? `<button class="btn btn-danger" data-act="del" style="margin-right:auto">清除</button>` : ''}
        <button class="btn btn-ghost" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">${cell ? '更新' : '保存'}</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'del') {
        await DB.op('schedule', 'delete', { id: cell.id }); closeModal(); toast('已清除', 'ok'); draw();
      }
      if (act === 'ok') {
        const data = { day, period, subject: val('sSub'), className: val('sCls'), note: val('sNote') };
        if (!data.className) { toast('请选择班级', 'err'); return; }
        if (cell) { await DB.op('schedule', 'update', { id: cell.id, data }); }
        else { await DB.op('schedule', 'create', { data }); }
        closeModal(); toast('已保存', 'ok'); draw();
      }
    };
  }

  /* 单条记录编辑/清除弹窗 */
  async function recordModal(cell) {
    openModal({
      title: `${DAYS[cell.day - 1]} · ${slotLabel(cell.period)} <span class="tt-modal-time">${slotTime(cell.period)}</span>`,
      body: `<div class="form-row"><label>科目</label><input class="input" id="sSub" value="${escapeHtml(cell.subject || '')}"></div>
        <div class="form-row"><label>班级</label>${classSelectHtml('sCls', cell.className || '')}</div>
        <div class="form-row"><label>备注</label><input class="input" id="sNote" value="${escapeHtml(cell.note || '')}"></div>`,
      foot: `<button class="btn btn-danger" data-act="del" style="margin-right:auto">清除</button>
        <button class="btn btn-ghost" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="ok">更新</button>`
    });
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'del') { await DB.op('schedule', 'delete', { id: cell.id }); closeModal(); toast('已清除', 'ok'); draw(); }
      if (act === 'ok') {
        const data = { day: cell.day, period: cell.period, subject: val('sSub'), className: val('sCls'), note: val('sNote') };
        if (!data.className) { toast('请选择班级', 'err'); return; }
        await DB.op('schedule', 'update', { id: cell.id, data }); closeModal(); toast('已保存', 'ok'); draw();
      }
    };
  }

  /* 合并视图：某时段（跨班级）的课程管理弹窗 */
  async function mergedCellModal(day, period) {
    openModal({
      title: `${DAYS[day - 1]} · ${slotLabel(period)} <span class="tt-modal-time">${slotTime(period)}</span>`,
      body: `<div id="mcList" class="mb16"></div>
        <div class="cr-hr"></div>
        <p class="section-desc mt16">添加该时段课程（可多个班级）：</p>
        <div class="form-row"><label>科目</label><input class="input" id="sSub" placeholder="如 数学"></div>
        <div class="form-row"><label>班级</label>${classSelectHtml('sCls', App.classList()[0] ? App.classList()[0].name : '')}</div>
        <div class="form-row"><label>备注</label><input class="input" id="sNote" placeholder="如 实验室"></div>`,
      foot: `<button class="btn btn-ghost" data-act="cancel">关闭</button><button class="btn btn-primary" data-act="add">添加课程</button>`
    });
    const listBox = $('#mcList');
    async function renderList() {
      const all = await DB.getAll('schedule');
      const recs = all.filter(x => x.day === day && x.period === period);
      if (!recs.length) { listBox.innerHTML = `<div class="empty">该时段暂无课程</div>`; return; }
      listBox.innerHTML = recs.map(r => `<div class="row list-item" style="align-items:flex-start">
        <div style="flex:1;min-width:0"><b>${escapeHtml(r.subject || '')}</b>${r.className ? ` <span class="tt-cls-tag">${escapeHtml(r.className)}</span>` : ''}${r.note ? `<div class="cls" style="font-size:11px;margin-top:2px">${escapeHtml(r.note)}</div>` : ''}</div>
        <span class="row" style="gap:6px;flex-shrink:0"><button class="btn btn-soft btn-xs" data-edit="${r.id}">改</button><button class="btn btn-ghost btn-xs" data-del="${r.id}">删</button></span>
      </div>`).join('');
      $$('[data-edit]', listBox).forEach(b => b.onclick = async () => {
        const rec = (await DB.getAll('schedule')).find(x => x.id === +b.dataset.edit);
        if (rec) { await recordModal(rec); await mergedCellModal(day, period); }
      });
      $$('[data-del]', listBox).forEach(b => b.onclick = async () => {
        if (await confirmBox('删除该课程？', { danger: true, okText: '删除' })) {
          await DB.op('schedule', 'delete', { id: +b.dataset.del }); toast('已删除', 'ok'); await renderList(); draw();
        }
      });
    }
    await renderList();
    $('#modalFoot').onclick = async e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'cancel') closeModal();
      if (act === 'add') {
        const data = { day, period, subject: val('sSub'), className: val('sCls'), note: val('sNote') };
        if (!data.className) { toast('请选择班级', 'err'); return; }
        await DB.op('schedule', 'create', { data }); toast('已添加', 'ok');
        $('#sSub').value = ''; $('#sNote').value = '';
        await renderList(); draw();
      }
    };
  }

  global.Schedule = { render };
})(window);
