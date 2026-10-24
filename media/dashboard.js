(function () {
  const vscode = acquireVsCodeApi();
  const META = window.__META__;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const label = (pairs, key) => (pairs.find((p) => p[0] === key) || [key, key])[1];
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  let tasks = [];
  let ui = Object.assign(
    { view: 'board', sort: 'newest', type: 'all', author: 'all', q: '', showDone: false },
    vscode.getState() || {}
  );
  const saveUi = () => vscode.setState(ui);

  // ---------- static controls ----------
  $('fType').innerHTML =
    '<option value="all">All types</option>' + META.types.map((t) => `<option value="${t[0]}">${esc(t[1])}</option>`).join('');
  $('sort').innerHTML = META.sorts.map((s) => `<option value="${s[0]}">${esc(s[1])}</option>`).join('');
  $('fType').value = ui.type;
  $('sort').value = ui.sort;
  $('q').value = ui.q;
  $('showDone').checked = ui.showDone;

  $('fType').onchange = (e) => { ui.type = e.target.value; saveUi(); render(); };
  $('fAuthor').onchange = (e) => { ui.author = e.target.value; saveUi(); render(); };
  $('sort').onchange = (e) => { ui.sort = e.target.value; saveUi(); render(); };
  $('q').oninput = (e) => { ui.q = e.target.value; saveUi(); render(); };
  $('showDone').onchange = (e) => { ui.showDone = e.target.checked; saveUi(); render(); };
  $('new').onclick = () => vscode.postMessage({ cmd: 'create' });
  $('viewSwitch').onclick = (e) => {
    const v = e.target.dataset && e.target.dataset.view;
    if (v) { ui.view = v; saveUi(); render(); }
  };

  // ---------- data ----------
  window.addEventListener('message', (e) => {
    if (e.data.cmd === 'state') {
      tasks = e.data.tasks;
      $('project').textContent = e.data.project;
      updateAuthors();
      render();
    }
  });
  vscode.postMessage({ cmd: 'ready' });

  function updateAuthors() {
    const authors = Array.from(new Set(tasks.map((t) => t.author))).sort();
    if (ui.author !== 'all' && authors.indexOf(ui.author) === -1) { ui.author = 'all'; }
    $('fAuthor').innerHTML =
      '<option value="all">All authors</option>' + authors.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    $('fAuthor').value = ui.author;
  }

  function visible() {
    const q = ui.q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!ui.showDone && t.status === 'done') { return false; }
      if (ui.type !== 'all' && t.type !== ui.type) { return false; }
      if (ui.author !== 'all' && t.author !== ui.author) { return false; }
      if (!q) { return true; }
      const hay = [t.title, t.description, t.author].concat(t.links.map((l) => l.path)).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function sorted(list) {
    const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);
    const by = {
      newest,
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || newest(a, b),
      title: (a, b) => a.title.localeCompare(b.title),
      type: (a, b) => a.type.localeCompare(b.type) || newest(a, b),
    };
    return list.slice().sort(by[ui.sort] || newest);
  }

  // ---------- rendering ----------
  const baseName = (l) => l.path.split('/').pop() || l.path;
  const lines = (l) => (l.line ? ':' + l.line + (l.endLine ? '-' + l.endLine : '') : '');
  const date = (iso) => new Date(iso).toLocaleDateString();

  function chips(t, max) {
    const shown = t.links.slice(0, max).map((l, i) =>
      `<button class="chip" data-act="link" data-id="${t.id}" data-i="${i}" title="${esc(l.path)}">${l.kind === 'folder' ? '📁' : '📄'} ${esc(baseName(l) + lines(l))}</button>`
    ).join('');
    const more = t.links.length > max ? `<span class="chip muted">+${t.links.length - max}</span>` : '';
    return shown + more;
  }

  function renderStats() {
    const count = (s) => tasks.filter((t) => t.status === s).length;
    const total = tasks.length;
    const done = count('done');
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('stats').innerHTML =
      `<div class="stat"><b>${total}</b><span>Total</span></div>` +
      `<div class="stat"><b>${count('todo')}</b><span>Not started</span></div>` +
      `<div class="stat"><b>${count('in-progress')}</b><span>In progress</span></div>` +
      `<div class="stat"><b>${done}</b><span>Done</span></div>` +
      `<div class="progress"><div class="muted">${pct}% complete</div><div class="bar"><i id="barFill"></i></div></div>`;
    $('barFill').style.width = pct + '%';
  }

  function card(t) {
    const prio = t.priority === 'high' ? '<span class="prio-high">▲ High</span>' : t.priority === 'low' ? '<span class="prio-low">▽ Low</span>' : '';
    const quick =
      (t.status === 'todo' ? `<button data-act="status" data-id="${t.id}" data-status="in-progress" title="Start">▶</button>` : '') +
      (t.status !== 'done'
        ? `<button data-act="status" data-id="${t.id}" data-status="done" title="Mark as done">✓</button>`
        : `<button data-act="status" data-id="${t.id}" data-status="todo" title="Restore">↺</button>`);
    return `<div class="card t-${t.type} ${t.status === 'done' ? 'done' : ''}" draggable="true" data-id="${t.id}" data-act="edit">
      <div class="quick">${quick}</div>
      <div class="title">${esc(t.title)}</div>
      ${t.description.trim() ? `<div class="desc">${esc(t.description)}</div>` : ''}
      <div class="row"><span class="badge">${esc(label(META.types, t.type))}</span>${prio}</div>
      ${t.links.length ? `<div class="row" style="margin-top:8px">${chips(t, 3)}</div>` : ''}
      <div class="meta"><span>${esc(t.author)}</span><span>${date(t.createdAt)}</span></div>
    </div>`;
  }

  function renderBoard(list) {
    const statuses = META.statuses.filter((s) => ui.showDone || s[0] !== 'done');
    $('main').innerHTML = '<div class="board">' + statuses.map((s) => {
      const items = sorted(list.filter((t) => t.status === s[0]));
      return `<div class="col" data-status="${s[0]}">
        <h2><span class="dot ${s[0]}"></span>${esc(s[1])} <span class="count">${items.length}</span></h2>
        ${items.length ? items.map(card).join('') : '<div class="empty">Nothing here</div>'}
      </div>`;
    }).join('') + '</div>';
  }

  function renderList(list) {
    if (!list.length) { $('main').innerHTML = '<div class="lempty">No tasks match.</div>'; return; }
    const rows = sorted(list).map((t) => `
      <div class="lrow t-${t.type} ${t.status === 'done' ? 'done' : ''}" data-act="edit" data-id="${t.id}">
        <div class="title" title="${esc(t.title)}">${esc(t.title)}</div>
        <div><span class="badge">${esc(label(META.types, t.type))}</span></div>
        <div><select data-act="statusSelect" data-id="${t.id}">${META.statuses.map((s) => `<option value="${s[0]}"${s[0] === t.status ? ' selected' : ''}>${esc(s[1])}</option>`).join('')}</select></div>
        <div class="${t.priority === 'high' ? 'prio-high' : ''}">${esc(label(META.priorities, t.priority))}</div>
        <div>${esc(t.author)}</div>
        <div class="muted">${date(t.createdAt)}</div>
        <div class="row">${chips(t, 2)}</div>
      </div>`).join('');
    $('main').innerHTML = `<div class="list">
      <div class="lrow head"><div>Title</div><div>Type</div><div>Status</div><div>Priority</div><div>Author</div><div>Created</div><div>Links</div></div>
      ${rows}</div>`;
  }

  function render() {
    renderStats();
    Array.prototype.forEach.call($('viewSwitch').children, (b) => b.classList.toggle('active', b.dataset.view === ui.view));
    const list = visible();
    if (!tasks.length) {
      $('main').innerHTML = '<div class="lempty">No tasks yet. Click “New task” to create the first one.</div>';
      return;
    }
    if (ui.view === 'list') { renderList(list); } else { renderBoard(list); }
  }

  // ---------- interaction (event delegation) ----------
  $('main').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') { return; }
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'status': e.stopPropagation(); vscode.postMessage({ cmd: 'status', id, status: el.dataset.status }); break;
      case 'link': e.stopPropagation(); vscode.postMessage({ cmd: 'link', id, index: Number(el.dataset.i) }); break;
      case 'edit': vscode.postMessage({ cmd: 'edit', id }); break;
    }
  });
  $('main').addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.act === 'statusSelect') {
      vscode.postMessage({ cmd: 'status', id: e.target.dataset.id, status: e.target.value });
    }
  });

  // drag a card onto another column to change its status
  let dragId = null;
  $('main').addEventListener('dragstart', (e) => {
    const c = e.target.closest('.card');
    if (!c) { return; }
    dragId = c.dataset.id;
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  $('main').addEventListener('dragend', () => {
    dragId = null;
    document.querySelectorAll('.dragging, .over').forEach((n) => n.classList.remove('dragging', 'over'));
  });
  $('main').addEventListener('dragover', (e) => {
    const col = e.target.closest('.col');
    if (col && dragId) {
      e.preventDefault();
      document.querySelectorAll('.col.over').forEach((n) => { if (n !== col) { n.classList.remove('over'); } });
      col.classList.add('over');
    }
  });
  $('main').addEventListener('drop', (e) => {
    const col = e.target.closest('.col');
    if (col && dragId) {
      e.preventDefault();
      const t = tasks.find((x) => x.id === dragId);
      if (t && t.status !== col.dataset.status) {
        vscode.postMessage({ cmd: 'status', id: dragId, status: col.dataset.status });
      }
    }
  });
})();
