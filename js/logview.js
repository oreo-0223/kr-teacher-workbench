/* ============================================================
   logview.js · 操作日志（只读，支持回滚）
   - 追加式日志，UI 不可编辑/删除任何条目
   - 按时间倒序展示，可按模块/类型筛选
   - 每条非回滚记录可回滚（回滚本身也登记日志，且不可被回滚）
   ============================================================ */
(function (global) {
  'use strict';
  const { $, $$, toast, openDrawer, openModal, closeModal, confirmBox } = App;

  const STORE_OPTS = [
    ['students', '花名册'], ['schedule', '课程表'], ['attendance', '考勤'],
    ['discipline', '纪律'], ['homeworkAssign', '作业布置'], ['homeworkCollect', '作业收缴'],
    ['teachingRecords', '教学记录'], ['abnormalLog', '异常登记'], ['grades', '成绩'], ['meta', '设置']
  ];
  const ACT_OPTS = [['create', '新增'], ['update', '修改'], ['delete', '删除'], ['rollback', '回滚']];

  async function open() {
    const body = `
      <div class="between mb16">
        <div><b>📜 操作日志</b><span class="muted"> · 只读，不可修改</span></div>
      </div>
      <div class="row mb16" style="gap:8px">
        <select class="input" id="lfStore" style="width:auto"><option value="">全部模块</option>${STORE_OPTS.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select>
        <select class="input" id="lfAct" style="width:auto"><option value="">全部类型</option>${ACT_OPTS.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select>
        <span class="muted nowrap" id="lfCount"></span>
      </div>
      <div id="logList"></div>`;
    openDrawer('📜 操作日志', body);
    let all = [];
    async function refresh() {
      all = (await DB.getAll('opLog')).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      draw();
    }
    function draw() {
      const fs = $('#lfStore').value, fa = $('#lfAct').value;
      const filtered = all.filter(e => (!fs || e.store === fs) && (!fa || e.action === fa));
      $('#lfCount').textContent = `${filtered.length} 条`;
      const wrap = $('#logList');
      if (!filtered.length) { wrap.innerHTML = `<div class="empty">暂无日志</div>`; return; }
      wrap.innerHTML = filtered.map(e => entryHtml(e)).join('');
      $$('[data-rb]', wrap).forEach(b => b.onclick = () => doRollback(+b.dataset.rb));
    }
    $('#lfStore').onchange = draw;
    $('#lfAct').onchange = draw;
    refresh();
  }

  function entryHtml(e) {
    const act = DB.actionText(e.action);
    const store = DB.storeLabel(e.store);
    const cls = e.action;
    const canRollback = e.action !== 'rollback';
    // 摘要：取关键字段
    const summ = summary(e);
    return `<div class="log-entry ${cls}">
      <div class="log-meta">
        <span><span class="tag ${actTag(e.action)}">${act}</span> ${store} #${e.entityId || '—'}</span>
        <span class="nowrap">${e.timeText || ''}</span>
      </div>
      <div class="log-body">${summ}</div>
      ${e.note ? `<div class="muted" style="font-size:12px;margin-top:4px">备注：${escapeHtml(e.note)}</div>` : ''}
      ${canRollback ? `<button class="btn btn-ghost btn-sm mt8" data-rb="${e.id}">↩ 回滚此操作</button>` : `<span class="muted" style="font-size:12px">此为回滚操作，不可再次回滚</span>`}
    </div>`;
  }

  function summary(e) {
    const obj = e.after || e.before || {};
    const pick = o => {
      if (!o) return '—';
      const keys = ['name', 'examName', 'content', 'progress', 'description', 'date', 'datetime', 'subject', 'teacher', 'no'];
      const out = keys.filter(k => o[k]).map(k => `${k}=${short(o[k])}`);
      return out.join('，') || JSON.stringify(o).slice(0, 80);
    };
    if (e.action === 'create') return `新增：${pick(e.after)}`;
    if (e.action === 'update') return `修改前：${pick(e.before)}<br>修改后：${pick(e.after)}`;
    if (e.action === 'delete') return `删除：${pick(e.before)}`;
    return e.note || '';
  }
  function short(v) { v = String(v); return v.length > 30 ? v.slice(0, 30) + '…' : v; }
  function actTag(a) { return { create: 'green', update: 'yellow', delete: 'red', rollback: 'gray' }[a] || 'gray'; }
  function escapeHtml(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }

  async function doRollback(id) {
    const ok = await confirmBox(
      '确定回滚此操作？',
      { danger: true, okText: '回滚', hint: '回滚会按规则还原数据：新增→删除该条；修改→还原为修改前；删除→恢复被删数据。回滚本身也会记入日志，且可再次回滚（撤销本次回滚）。' }
    );
    if (!ok) return;
    try {
      await DB.rollback(id);
      toast('已回滚，请刷新对应页面查看', 'ok');
      open();
    } catch (err) {
      toast('回滚失败：' + err.message, 'err');
    }
  }

  global.LogView = { open };
})(window);
