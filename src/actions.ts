import * as vscode from 'vscode';
import { TaskStore } from './store';
import { STATUS_META, STATUS_ORDER, Task, TaskLink, TaskStatus, TYPE_META } from './model';

/** Changes status. Completing a task only hides it - and offers an immediate Undo. */
export async function setStatus(store: TaskStore, task: Task, status: TaskStatus): Promise<void> {
  const previous = task.status;
  if (previous === status) {
    return;
  }
  await store.update(task.id, { status });
  if (status === 'done') {
    void vscode.window
      .showInformationMessage(`Done: "${task.title}". It's hidden, not deleted.`, 'Undo')
      .then((choice) => (choice === 'Undo' ? store.update(task.id, { status: previous }) : undefined));
  }
}

export async function pickStatus(current?: TaskStatus): Promise<TaskStatus | undefined> {
  const pick = await vscode.window.showQuickPick(
    STATUS_ORDER.map((s) => ({
      label: `$(${STATUS_META[s].icon}) ${STATUS_META[s].label}`,
      description: s === current ? 'current' : '',
      status: s,
    })),
    { placeHolder: 'Move task to...' }
  );
  return pick?.status;
}

export async function pickTask(store: TaskStore, placeHolder: string, includeDone = true): Promise<Task | undefined> {
  const tasks = store.all().filter((t) => includeDone || t.status !== 'done');
  if (!tasks.length) {
    void vscode.window.showInformationMessage('No tasks yet. Create one first.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    tasks
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({
        label: `$(${TYPE_META[t.type].icon}) ${t.title}`,
        description: `${TYPE_META[t.type].label} · ${STATUS_META[t.status].label}`,
        detail: t.author,
        task: t,
      })),
    { placeHolder, matchOnDescription: true }
  );
  return pick?.task;
}

/** Commands get either a tree node, a task id (from the dashboard) or nothing (command palette). */
export async function taskFromArg(store: TaskStore, arg?: unknown): Promise<Task | undefined> {
  if (typeof arg === 'string') {
    return store.get(arg);
  }
  const node = arg as { task?: Task } | undefined;
  if (node && typeof node === 'object' && node.task) {
    return store.get(node.task.id) ?? node.task;
  }
  return pickTask(store, 'Select a task');
}

export async function openLink(store: TaskStore, link: TaskLink): Promise<void> {
  const uri = store.uriOf(link);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`"${link.path}" was not found. It may have been moved or deleted.`);
    return;
  }
  if (link.kind === 'folder') {
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return;
  }
  const options: vscode.TextDocumentShowOptions = { preview: false };
  if (link.line) {
    const start = new vscode.Position(Math.max(0, link.line - 1), 0);
    const end = new vscode.Position(Math.max(0, (link.endLine ?? link.line) - 1), Number.MAX_SAFE_INTEGER);
    options.selection = new vscode.Range(start, end);
  }
  await vscode.window.showTextDocument(uri, options);
}
