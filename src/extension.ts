import * as vscode from 'vscode';
import { TaskStore } from './store';
import { Node, TaskTreeProvider } from './treeView';
import { TaskForm } from './taskForm';
import { Dashboard } from './dashboard';
import { openLink, pickStatus, setStatus, taskFromArg } from './actions';
import { SORT_META, SortMode, Task, TaskLink, TaskType, TYPE_META } from './model';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const store = new TaskStore();
  await store.init();

  const tree = new TaskTreeProvider(store, ctx.workspaceState);
  const view = vscode.window.createTreeView('taskBoard.tasks', { treeDataProvider: tree, showCollapseAll: true });
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'taskBoard.openDashboard';

  const hasFolder = () => {
    if (!store.root) {
      void vscode.window.showWarningMessage('Task Board needs an open folder.');
      return false;
    }
    return true;
  };

  // Keep badge, status bar and view header in sync.
  const refreshChrome = () => {
    const open = store.all().filter((t) => t.status !== 'done');
    const active = open.filter((t) => t.status === 'in-progress').length;
    statusBar.text = `$(checklist) ${open.length}`;
    statusBar.tooltip = `Task Board: ${open.length} open, ${active} in progress. Click to open the dashboard.`;
    statusBar.show();
    view.badge = open.length ? { value: open.length, tooltip: `${open.length} open tasks` } : undefined;
    view.description = tree.describe();
    view.message =
      !tree.showDone && store.all().length > 0 && open.length === 0
        ? 'All tasks are done. Use the eye icon to show completed tasks.'
        : undefined;
    void vscode.commands.executeCommand('setContext', 'taskBoard.showDone', tree.showDone);
  };
  refreshChrome();
  ctx.subscriptions.push(store.onDidChange(refreshChrome), tree.onDidChangeTreeData(refreshChrome));

  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(`taskBoard.${id}`, fn));

  // Quick pick: attach links to an existing task or to a brand new one.
  const attach = async (links: TaskLink[], column?: vscode.ViewColumn) => {
    const picks: (vscode.QuickPickItem & { task?: Task })[] = [
      { label: '$(add) New task...' },
      ...store
        .all()
        .filter((t) => t.status !== 'done')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((t) => ({ label: `$(${TYPE_META[t.type].icon}) ${t.title}`, description: t.author, task: t })),
    ];
    const choice = await vscode.window.showQuickPick(picks, { placeHolder: 'Link to which task?' });
    if (!choice) {
      return;
    }
    if (choice.task) {
      await store.addLinks(choice.task.id, links);
      void vscode.window.showInformationMessage(`Linked to "${choice.task.title}".`);
    } else {
      TaskForm.open(ctx, store, { prefill: { links }, column });
    }
  };

  const selectionLink = async (editor: vscode.TextEditor): Promise<TaskLink | undefined> => {
    const sel = editor.selection;
    let endLine = sel.end.line + 1;
    if (!sel.isEmpty && sel.end.character === 0 && sel.end.line > sel.start.line) {
      endLine -= 1; // selection ends at the very start of the next line
    }
    const link = await store.makeLink(editor.document.uri, { line: sel.start.line + 1, endLine });
    if (!link) {
      void vscode.window.showWarningMessage('This file is not inside the workspace, so it can not be linked.');
    }
    return link;
  };

  reg('create', () => {
    if (hasFolder()) {
      TaskForm.open(ctx, store);
    }
  });

  reg('createFromSelection', async () => {
    if (!hasFolder()) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      TaskForm.open(ctx, store);
      return;
    }
    const link = await selectionLink(editor);
    const text = editor.document.getText(editor.selection);
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
    // Strip comment markers and TODO/FIXME prefixes: "// TODO: fix this" -> "fix this"
    const title = firstLine
      .replace(/^\s*(\/\/+|#+|\/\*+|\*+|--|<!--)?\s*(TODO|FIXME|FIX|BUG|HACK|XXX)?\s*(\([^)]*\))?\s*:?\s*/i, '')
      .replace(/(\*\/|-->)\s*$/, '')
      .trim()
      .slice(0, 100);
    let type: TaskType = 'feature';
    if (/\b(FIXME|FIX|BUG|HACK)\b/i.test(firstLine)) { type = 'fix'; }
    else if (/\bREFACTOR\b/i.test(firstLine)) { type = 'refactor'; }
    else if (/\bDOCS?\b/i.test(firstLine)) { type = 'docs'; }
    else if (/\bTEST\b/i.test(firstLine)) { type = 'test'; }
    TaskForm.open(ctx, store, {
      prefill: { title, type, links: link ? [link] : [] },
      column: vscode.ViewColumn.Beside,
    });
  });

  reg('linkSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !hasFolder()) {
      return;
    }
    const link = await selectionLink(editor);
    if (link) {
      await attach([link], vscode.ViewColumn.Beside);
    }
  });

  reg('linkToTask', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    if (!hasFolder()) {
      return;
    }
    const targets = uris?.length ? uris : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
    const links = (await Promise.all(targets.map((u) => store.makeLink(u)))).filter((l): l is TaskLink => !!l);
    if (!links.length) {
      void vscode.window.showWarningMessage('Nothing to link: select files or folders inside the workspace.');
      return;
    }
    await attach(links);
  });

  reg('openDashboard', () => Dashboard.show(ctx, store));

  reg('edit', async (arg?: unknown) => {
    const task = await taskFromArg(store, arg);
    if (task) {
      TaskForm.open(ctx, store, { taskId: task.id });
    }
  });

  reg('start', async (arg?: unknown) => { const t = await taskFromArg(store, arg); if (t) { await setStatus(store, t, 'in-progress'); } });
  reg('complete', async (arg?: unknown) => { const t = await taskFromArg(store, arg); if (t) { await setStatus(store, t, 'done'); } });
  reg('reopen', async (arg?: unknown) => { const t = await taskFromArg(store, arg); if (t) { await setStatus(store, t, 'todo'); } });

  reg('move', async (arg?: unknown) => {
    const task = await taskFromArg(store, arg);
    if (!task) {
      return;
    }
    const status = await pickStatus(task.status);
    if (status) {
      await setStatus(store, task, status);
    }
  });

  reg('delete', async (arg?: unknown) => {
    const task = await taskFromArg(store, arg);
    if (!task) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete "${task.title}" permanently? To just hide it, mark it as Done instead.`,
      { modal: true },
      'Delete'
    );
    if (choice === 'Delete') {
      await store.delete(task.id);
    }
  });

  reg('openLink', async (node?: Node) => {
    if (node?.kind === 'link') {
      const link = node.task.links[node.index];
      if (link) {
        await openLink(store, link);
      }
    }
  });

  reg('removeLink', async (node?: Node) => {
    if (node?.kind === 'link') {
      const task = store.get(node.task.id);
      if (task) {
        await store.update(task.id, { links: task.links.filter((_, i) => i !== node.index) });
      }
    }
  });

  reg('showCompleted', () => tree.setShowDone(true));
  reg('hideCompleted', () => tree.setShowDone(false));

  reg('sort', async () => {
    const pick = await vscode.window.showQuickPick(
      (Object.keys(SORT_META) as SortMode[]).map((m) => ({
        label: SORT_META[m],
        description: m === tree.sort ? 'current' : '',
        mode: m,
      })),
      { placeHolder: 'Sort tasks by...' }
    );
    if (pick) {
      tree.setSort(pick.mode);
    }
  });

  reg('filter', async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'All types', type: 'all' as const },
        ...(Object.keys(TYPE_META) as TaskType[]).map((t) => ({
          label: `$(${TYPE_META[t].icon}) ${TYPE_META[t].label}`,
          description: t === tree.typeFilter ? 'current' : '',
          type: t,
        })),
      ],
      { placeHolder: 'Show only...' }
    );
    if (pick) {
      tree.setTypeFilter(pick.type);
    }
  });

  reg('refresh', () => store.reload());

  ctx.subscriptions.push(store, tree, view, statusBar);
}

export function deactivate(): void {}
