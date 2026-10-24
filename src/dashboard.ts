import * as vscode from 'vscode';
import { TaskStore } from './store';
import { PRIORITY_META, SORT_META, STATUS_META, STATUS_ORDER, TYPE_META, TaskStatus } from './model';
import { TaskForm } from './taskForm';
import { openLink, setStatus } from './actions';
import { page, webviewOptions } from './webviewUtil';

/** The overview: board + list of every task, with search, filters and sorting. */
export class Dashboard {
  private static current?: Dashboard;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(ctx: vscode.ExtensionContext, store: TaskStore): void {
    if (Dashboard.current) {
      Dashboard.current.panel.reveal();
      return;
    }
    Dashboard.current = new Dashboard(ctx, store);
  }

  private constructor(private ctx: vscode.ExtensionContext, private store: TaskStore) {
    this.panel = vscode.window.createWebviewPanel('taskBoard.dashboard', 'Task Board', vscode.ViewColumn.Active, {
      ...webviewOptions(ctx),
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.svg');

    const meta = {
      types: Object.entries(TYPE_META).map(([k, v]) => [k, v.label]),
      statuses: STATUS_ORDER.map((s) => [s, STATUS_META[s].label]),
      priorities: Object.entries(PRIORITY_META).map(([k, v]) => [k, v.label]),
      sorts: Object.entries(SORT_META),
    };

    this.panel.webview.html = page(ctx, this.panel.webview, {
      title: 'Task Board',
      script: 'dashboard.js',
      data: { __META__: meta },
      body: `
<div class="dash">
  <header class="top">
    <div>
      <h1>Task Board</h1>
      <div class="muted" id="project"></div>
    </div>
    <button class="btn primary" id="new" type="button">+ New task</button>
  </header>

  <section class="stats" id="stats"></section>

  <section class="toolbar">
    <input id="q" type="search" placeholder="Search tasks, files, authors...">
    <select id="fType" title="Type"></select>
    <select id="fAuthor" title="Author"></select>
    <select id="sort" title="Sort"></select>
    <label class="check"><input type="checkbox" id="showDone"> Show completed</label>
    <div class="seg" id="viewSwitch">
      <button type="button" data-view="board">Board</button>
      <button type="button" data-view="list">List</button>
    </div>
  </section>

  <main id="main"></main>
</div>`,
    });

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m) => void this.onMessage(m)),
      store.onDidChange(() => this.push())
    );
    this.panel.onDidDispose(() => {
      this.disposables.forEach((d) => d.dispose());
      Dashboard.current = undefined;
    });
  }

  private push(): void {
    void this.panel.webview.postMessage({
      cmd: 'state',
      tasks: this.store.all(),
      project: vscode.workspace.workspaceFolders?.[0]?.name ?? '',
    });
  }

  private async onMessage(msg: { cmd: string; id?: string; status?: string; index?: number }): Promise<void> {
    const task = msg.id ? this.store.get(msg.id) : undefined;
    switch (msg.cmd) {
      case 'ready':
        this.push();
        break;
      case 'create':
        TaskForm.open(this.ctx, this.store, { column: vscode.ViewColumn.Beside });
        break;
      case 'edit':
        if (task) {
          TaskForm.open(this.ctx, this.store, { taskId: task.id, column: vscode.ViewColumn.Beside });
        }
        break;
      case 'status':
        if (task && STATUS_ORDER.includes(msg.status as TaskStatus)) {
          await setStatus(this.store, task, msg.status as TaskStatus);
        }
        break;
      case 'link': {
        const link = task && msg.index !== undefined ? task.links[msg.index] : undefined;
        if (link) {
          await openLink(this.store, link);
        }
        break;
      }
    }
  }
}
