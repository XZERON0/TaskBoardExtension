import * as vscode from 'vscode';
import { TaskStore } from './store';
import { PRIORITY_META, STATUS_META, Task, TaskLink, TYPE_META } from './model';
import { page, webviewOptions } from './webviewUtil';

interface OpenOptions {
  taskId?: string;
  prefill?: Partial<Task>;
  column?: vscode.ViewColumn;
}

export class TaskForm {
  private static editing = new Map<string, vscode.WebviewPanel>();

  static open(ctx: vscode.ExtensionContext, store: TaskStore, opts: OpenOptions = {}): void {
    const existing = opts.taskId ? TaskForm.editing.get(opts.taskId) : undefined;
    if (existing) {
      existing.reveal();
      return;
    }
    const task = opts.taskId ? store.get(opts.taskId) : undefined;
    if (opts.taskId && !task) {
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'taskBoard.form',
      task ? 'Edit task' : 'New task',
      opts.column ?? vscode.ViewColumn.Active,
      webviewOptions(ctx)
    );
    if (task) {
      TaskForm.editing.set(task.id, panel);
    }

    const data = {
      __INIT__: {
        task: task ?? null,
        prefill: opts.prefill ?? null,
        author: store.author,
        meta: {
          types: Object.entries(TYPE_META).map(([k, v]) => [k, v.label]),
          statuses: Object.entries(STATUS_META).map(([k, v]) => [k, v.label]),
          priorities: Object.entries(PRIORITY_META).map(([k, v]) => [k, v.label]),
        },
      },
    };
    panel.webview.html = page(ctx, panel.webview, {
      title: 'Task',
      script: 'form.js',
      data,
      body: `
<div class="form">
  <header>
    <h1 id="heading"></h1>
    <div class="muted" id="meta"></div>
  </header>

  <label for="title">Title</label>
  <input id="title" type="text" placeholder="What needs to be done?" autofocus>

  <label for="desc">Description</label>
  <textarea id="desc" rows="6" placeholder="Details, context, acceptance criteria..."></textarea>

  <label>Type</label>
  <div id="type" class="seg wrap"></div>

  <div class="two">
    <div><label>Status</label><div id="status" class="seg"></div></div>
    <div><label>Priority</label><div id="priority" class="seg"></div></div>
  </div>

  <label>Linked files and folders</label>
  <div id="links" class="linklist"></div>
  <div class="actions">
    <button class="btn" id="addFiles" type="button">+ Add files</button>
    <button class="btn" id="addFolder" type="button">+ Add folder</button>
  </div>

  <footer>
    <button class="btn danger" id="delete" type="button">Delete</button>
    <span class="spacer"></span>
    <button class="btn" id="cancel" type="button">Cancel</button>
    <button class="btn primary" id="save" type="button">Save <span class="kbd">Ctrl+Enter</span></button>
  </footer>
</div>`,
    });

    const sub = panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.cmd) {
        case 'pick': {
          const isFolder = msg.kind === 'folder';
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: !isFolder,
            canSelectFolders: isFolder,
            canSelectMany: true,
            defaultUri: store.root,
            openLabel: 'Link',
          });
          if (!uris?.length) {
            return;
          }
          const links: TaskLink[] = [];
          for (const uri of uris) {
            const link = await store.makeLink(uri);
            if (link) {
              links.push(link);
            } else {
              void vscode.window.showWarningMessage(`${uri.fsPath} is outside the workspace and can't be linked.`);
            }
          }
          void panel.webview.postMessage({ cmd: 'links', links });
          break;
        }
        case 'save': {
          const t = msg.task as Partial<Task>;
          if (!t.title?.trim()) {
            return;
          }
          const fields = {
            title: t.title.trim(),
            description: t.description ?? '',
            type: t.type,
            status: t.status,
            priority: t.priority,
            links: t.links ?? [],
          };
          if (task) {
            await store.update(task.id, fields);
          } else {
            await store.create(fields);
          }
          panel.dispose();
          break;
        }
        case 'delete': {
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
            panel.dispose();
          }
          break;
        }
        case 'cancel':
          panel.dispose();
          break;
      }
    });

    panel.onDidDispose(() => {
      sub.dispose();
      if (task) {
        TaskForm.editing.delete(task.id);
      }
    });
  }
}
