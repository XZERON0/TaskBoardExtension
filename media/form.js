(function () {
  const vscode = acquireVsCodeApi();
  const init = window.__INIT__;
  const $ = (id) => document.getElementById(id);

  const existing = init.task;
  const base = { title: '', description: '', type: 'feature', status: 'todo', priority: 'medium', links: [] };
  const task = Object.assign({}, base, init.prefill || {}, existing || {});
  let links = (task.links || []).slice();

  // ---- header ----
  $('heading').textContent = existing ? 'Edit task' : 'New task';
  $('meta').textContent = existing
    ? 'Created by ' + existing.author + ' on ' + new Date(existing.createdAt).toLocaleString() +
      (existing.updatedAt !== existing.createdAt ? ' · updated ' + new Date(existing.updatedAt).toLocaleString() : '')
    : 'Author: ' + init.author;
  if (!existing) { $('delete').style.display = 'none'; }

  $('title').value = task.title;
  $('desc').value = task.description;

  // ---- segmented controls ----
  function seg(el, entries, value, withType) {
    let current = value;
    el.innerHTML = '';
    entries.forEach(function (entry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = entry[1];
      if (withType) { b.classList.add('t-' + entry[0]); }
      if (entry[0] === current) { b.classList.add('active'); }
      b.addEventListener('click', function () {
        current = entry[0];
        Array.prototype.forEach.call(el.children, function (c) { c.classList.remove('active'); });
        b.classList.add('active');
      });
      el.appendChild(b);
    });
    return function () { return current; };
  }
  const getType = seg($('type'), init.meta.types, task.type, true);
  const getStatus = seg($('status'), init.meta.statuses, task.status, false);
  const getPriority = seg($('priority'), init.meta.priorities, task.priority, false);

  // ---- links ----
  function label(l) {
    return l.path + (l.line ? ':' + l.line + (l.endLine ? '-' + l.endLine : '') : '') + (l.kind === 'folder' ? '/' : '');
  }
  function renderLinks() {
    const box = $('links');
    box.innerHTML = '';
    if (!links.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Nothing linked yet.';
      box.appendChild(e);
      return;
    }
    links.forEach(function (l, i) {
      const row = document.createElement('div');
      row.className = 'linkrow';
      const icon = document.createElement('span');
      icon.textContent = l.kind === 'folder' ? '📁' : '📄';
      const p = document.createElement('span');
      p.className = 'path';
      p.textContent = label(l);
      p.title = label(l);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Remove link';
      x.addEventListener('click', function () { links.splice(i, 1); renderLinks(); });
      row.append(icon, p, x);
      box.appendChild(row);
    });
  }
  renderLinks();

  $('addFiles').addEventListener('click', function () { vscode.postMessage({ cmd: 'pick', kind: 'file' }); });
  $('addFolder').addEventListener('click', function () { vscode.postMessage({ cmd: 'pick', kind: 'folder' }); });

  window.addEventListener('message', function (e) {
    if (e.data.cmd === 'links') {
      const key = function (l) { return l.path + '|' + (l.line || '') + '|' + (l.endLine || ''); };
      const seen = new Set(links.map(key));
      e.data.links.forEach(function (l) { if (!seen.has(key(l))) { links.push(l); } });
      renderLinks();
    }
  });

  // ---- actions ----
  function save() {
    const title = $('title').value.trim();
    if (!title) {
      $('title').classList.add('invalid');
      $('title').focus();
      return;
    }
    vscode.postMessage({
      cmd: 'save',
      task: {
        title: title,
        description: $('desc').value,
        type: getType(),
        status: getStatus(),
        priority: getPriority(),
        links: links,
      },
    });
  }
  $('save').addEventListener('click', save);
  $('cancel').addEventListener('click', function () { vscode.postMessage({ cmd: 'cancel' }); });
  $('delete').addEventListener('click', function () { vscode.postMessage({ cmd: 'delete' }); });
  $('title').addEventListener('input', function () { $('title').classList.remove('invalid'); });
  $('title').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  });
  $('title').focus();
})();
