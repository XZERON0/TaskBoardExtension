import * as vscode from 'vscode';
import * as path from 'path';
import { TaskStore } from './store';
import {
  PRIORITY_META, SORT_META, STATUS_META, STATUS_ORDER, SortMode, Task, TaskStatus, TaskType, TYPE_META, sortTasks,
} from './model';

export interface GroupNode { kind: 'group'; status: TaskStatus; tasks: Task[] }
export interface TaskNode { kind: 'task'; task: Task }
export interface LinkNode { kind: 'link'; task: Task; index: number }
export type Node = GroupNode | TaskNode | LinkNode;

const md = (s: string) => s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');

export class TaskTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private sub: vscode.Disposable;

  sort: SortMode;
  typeFilter: TaskType | 'all';
  showDone: boolean;

  constructor(private store: TaskStore, private state: vscode.Memento) {
    this.sort = state.get<SortMode>('sort', 'newest');
    this.typeFilter = state.get<TaskType | 'all'>('typeFilter', 'all');
    this.showDone = state.get<boolean>('showDone', false);
    this.sub = store.onDidChange(() => this.emitter.fire());
  }

  setSort(mode: SortMode) { this.sort = mode; void this.state.update('sort', mode); this.emitter.fire(); }
  setTypeFilter(t: TaskType | 'all') { this.typeFilter = t; void this.state.update('typeFilter', t); this.emitter.fire(); }
  setShowDone(v: boolean) { this.showDone = v; void this.state.update('showDone', v); this.emitter.fire(); }

  /** Text for the view header, e.g. "Fix · Newest first". */
  describe(): string {
    const parts: string[] = [];
    if (this.typeFilter !== 'all') { parts.push(TYPE_META[this.typeFilter].label); }
    parts.push(SORT_META[this.sort]);
    return parts.join(' · ');
  }

  private filtered(): Task[] {
    return this.store.all().filter((t) => this.typeFilter === 'all' || t.type === this.typeFilter);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const tasks = this.filtered();
      return STATUS_ORDER
        .filter((s) => s !== 'done' || this.showDone)
        .map((status): GroupNode => ({ kind: 'group', status, tasks: sortTasks(tasks.filter((t) => t.status === status), this.sort) }))
        .filter((g) => g.tasks.length > 0);
    }
    if (node.kind === 'group') {
      return node.tasks.map((task): TaskNode => ({ kind: 'task', task }));
    }
    if (node.kind === 'task') {
      return node.task.links.map((_, index): LinkNode => ({ kind: 'link', task: node.task, index }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const meta = STATUS_META[node.status];
      const item = new vscode.TreeItem(
        meta.label,
        node.status === 'done' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = `group:${node.status}`;
      item.description = String(node.tasks.length);
      item.iconPath = new vscode.ThemeIcon(meta.icon, new vscode.ThemeColor(meta.color));
      item.contextValue = 'group';
      return item;
    }

    if (node.kind === 'task') {
      const t = node.task;
      const item = new vscode.TreeItem(
        t.title,
        t.links.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
      );
      item.id = `task:${t.id}`;
      item.description = [TYPE_META[t.type].label, t.priority === 'high' ? '▲ high' : '', t.author].filter(Boolean).join(' · ');
      item.iconPath = new vscode.ThemeIcon(TYPE_META[t.type].icon, new vscode.ThemeColor(STATUS_META[t.status].color));
      item.contextValue = `task-${t.status}`;
      item.tooltip = this.tooltip(t);
      item.command = { command: 'taskBoard.edit', title: 'Edit task', arguments: [node] };
      return item;
    }

    const link = node.task.links[node.index];
    const lines = link.line ? `:${link.line}${link.endLine ? `-${link.endLine}` : ''}` : '';
    const item = new vscode.TreeItem(`${path.posix.basename(link.path) || link.path}${lines}`);
    const dir = path.posix.dirname(link.path);
    item.id = `link:${node.task.id}:${node.index}`;
    item.description = dir === '.' ? '' : dir;
    item.resourceUri = this.store.uriOf(link);
    item.iconPath = link.kind === 'folder' ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    item.contextValue = 'link';
    item.tooltip = link.path + lines;
    item.command = { command: 'taskBoard.openLink', title: 'Open', arguments: [node] };
    return item;
  }

  private tooltip(t: Task): vscode.MarkdownString {
    const m = new vscode.MarkdownString();
    m.appendMarkdown(`**${md(t.title)}**\n\n`);
    m.appendMarkdown(`${TYPE_META[t.type].label} · ${STATUS_META[t.status].label} · ${PRIORITY_META[t.priority].label} priority\n\n`);
    if (t.description.trim()) {
      m.appendMarkdown(`${md(t.description.trim().slice(0, 400))}\n\n`);
    }
    m.appendMarkdown(`*${md(t.author)} · ${new Date(t.createdAt).toLocaleDateString()}*`);
    return m;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}
