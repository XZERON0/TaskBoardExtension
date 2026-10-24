import * as vscode from 'vscode';
import { TaskStore } from '../../task-board/src/store';
import { PRIORITY_META, STATUS_META, Task, TYPE_META } from '../../task-board/src/model';

interface Anchor {
  task: Task;
  line: number;      // 1-based line where the marker is shown
  endLine: number;   // last highlighted line (== line when nothing is highlighted)
  ranged: boolean;   // true if the link points at specific lines (-> highlight them)
  note?: string;     // e.g. "whole file" / "folder src/auth"
}

const short = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s).replace(/\$\(/g, '$ (');

/**
 * Shows linked tasks inside the files themselves:
 *  - a CodeLens above the linked line, collapsed by default (just the title); a click expands it
 *    into details + actions (open task, change status, done);
 *  - a soft highlight with a left border over the linked lines.
 */
export class EditorMarkers implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  private readonly expanded = new Set<string>();
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    borderWidth: '0 0 0 2px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('charts.blue'),
    overviewRulerColor: new vscode.ThemeColor('charts.blue'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: TaskStore) {
    this.disposables.push(
      this.lensEmitter,
      this.highlight,
      store.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('taskBoard.showInEditor')) {
          this.refresh();
        }
      }),
      vscode.commands.registerCommand('taskBoard.toggleLens', (key: string) => {
        if (!this.expanded.delete(key)) {
          this.expanded.add(key);
        }
        this.lensEmitter.fire();
      })
    );
    this.decorate();
  }

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('taskBoard').get<boolean>('showInEditor', true);
  }

  private refresh(): void {
    this.lensEmitter.fire();
    this.decorate();
  }

  /** Open tasks that point at this file (directly, or through a folder link). */
  private anchorsFor(rel: string, lineCount: number): Anchor[] {
    const clamp = (n: number) => Math.min(Math.max(n, 1), Math.max(lineCount, 1));
    const out: Anchor[] = [];
    const seen = new Set<string>();
    for (const task of this.store.all()) {
      if (task.status === 'done') {
        continue; // completed tasks are hidden everywhere
      }
      for (const l of task.links) {
        let anchor: Anchor | undefined;
        if (l.kind === 'file' && l.path === rel) {
          const line = clamp(l.line ?? 1);
          anchor = {
            task, line, endLine: clamp(l.endLine ?? line), ranged: !!l.line,
            note: l.line ? undefined : 'whole file',
          };
        } else if (l.kind === 'folder' && l.path !== '.' && rel.startsWith(l.path + '/')) {
          anchor = { task, line: 1, endLine: 1, ranged: false, note: `folder ${l.path}` };
        }
        const key = anchor && `${task.id}:${anchor.line}`;
        if (anchor && key && !seen.has(key)) {
          seen.add(key);
          out.push(anchor);
        }
      }
    }
    return out;
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const rel = this.enabled ? this.store.relativePath(doc.uri) : undefined;
    if (rel === undefined) {
      return [];
    }
    const byLine = new Map<number, Anchor[]>();
    for (const a of this.anchorsFor(rel, doc.lineCount)) {
      byLine.set(a.line, [...(byLine.get(a.line) ?? []), a]);
    }

    const lenses: vscode.CodeLens[] = [];
    for (const [line, list] of [...byLine].sort((a, b) => a[0] - b[0])) {
      const range = new vscode.Range(line - 1, 0, line - 1, 0);
      const key = `${rel}:${line}`;
      const add = (title: string, command: string, args: unknown[], tooltip?: string) =>
        lenses.push(new vscode.CodeLens(range, { title, command, arguments: args, tooltip }));

      if (!this.expanded.has(key)) {
        const first = list[0];
        const title =
          list.length === 1
            ? `$(checklist) ${short(first.task.title, 48)}${first.note ? ` · ${first.note}` : ''}`
            : `$(checklist) ${list.length} tasks`;
        const tooltip = list.map((a) => `${a.task.title} (${STATUS_META[a.task.status].label})`).join('\n');
        add(title, 'taskBoard.toggleLens', [key], `${tooltip}\n\nClick to expand`);
        continue;
      }

      add('$(chevron-down) Collapse', 'taskBoard.toggleLens', [key], 'Collapse');
      for (const a of list) {
        const t = a.task;
        add(`$(${TYPE_META[t.type].icon}) ${short(t.title, 60)}`, 'taskBoard.edit', [t.id], 'Open this task');
        add(
          `${STATUS_META[t.status].label} · ${TYPE_META[t.type].label} · ${PRIORITY_META[t.priority].label}`,
          'taskBoard.move', [t.id], `By ${t.author}. Click to change status`
        );
        if (a.note) {
          add(a.note, 'taskBoard.edit', [t.id]);
        }
        add('$(check) Done', 'taskBoard.complete', [t.id], 'Mark as done (hides it, can be undone)');
      }
    }
    return lenses;
  }

  private decorate(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const doc = editor.document;
      const rel = this.enabled ? this.store.relativePath(doc.uri) : undefined;
      const ranges =
        rel === undefined
          ? []
          : this.anchorsFor(rel, doc.lineCount)
              .filter((a) => a.ranged)
              .map((a) => new vscode.Range(a.line - 1, 0, a.endLine - 1, 0));
      editor.setDecorations(this.highlight, ranges);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
