import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { Task, TaskLink, normalizeTask, serializeTask } from './model';

export const TASKS_DIR = '.tasks';

type TaskPatch = Partial<Omit<Task, 'id' | 'author' | 'createdAt'>>;

/**
 * Tasks are stored as one JSON file per task in <workspace>/.tasks/.
 * One file per task means git merges almost never conflict.
 */
export class TaskStore implements vscode.Disposable {
  private tasks = new Map<string, Task>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private _author = '';

  get root(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private get dir(): vscode.Uri | undefined {
    const root = this.root;
    return root && vscode.Uri.joinPath(root, TASKS_DIR);
  }

  get author(): string {
    return this._author;
  }

  async init(): Promise<void> {
    this._author = await this.resolveAuthor();
    await this.reload();

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, `${TASKS_DIR}/*.json`)
      );
      const schedule = () => this.scheduleReload();
      this.disposables.push(watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule), watcher.onDidDelete(schedule));
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        this._author = await this.resolveAuthor();
        await this.reload();
      }),
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('taskBoard.author')) {
          this._author = await this.resolveAuthor();
        }
      })
    );
  }

  all(): Task[] {
    return [...this.tasks.values()];
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  async reload(): Promise<void> {
    const dir = this.dir;
    const next = new Map<string, Task>();
    if (dir) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        await Promise.all(
          entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
            .map(async ([name]) => {
              const id = name.replace(/\.json$/, '');
              try {
                const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
                const task = normalizeTask(JSON.parse(Buffer.from(bytes).toString('utf8')), id);
                if (task) {
                  next.set(task.id, task);
                }
              } catch {
                // File is half-written or broken: keep what we already had for it.
                const prev = this.tasks.get(id);
                if (prev) {
                  next.set(id, prev);
                }
              }
            })
        );
      } catch {
        // .tasks/ doesn't exist yet - that's fine.
      }
    }
    this.tasks = next;
    this.emitter.fire();
  }

  async create(input: Partial<Task>): Promise<Task> {
    const now = new Date().toISOString();
    const status = input.status ?? 'todo';
    const task: Task = {
      id: Date.now().toString(36) + randomBytes(2).toString('hex'),
      title: (input.title ?? '').trim() || 'Untitled task',
      description: input.description ?? '',
      type: input.type ?? 'feature',
      status,
      priority: input.priority ?? 'medium',
      author: this._author,
      createdAt: now,
      updatedAt: now,
      links: input.links ?? [],
    };
    if (status === 'done') {
      task.completedAt = now;
    }
    await this.write(task);
    return task;
  }

  async update(id: string, patch: TaskPatch): Promise<Task | undefined> {
    const current = this.tasks.get(id);
    if (!current) {
      return undefined;
    }
    const now = new Date().toISOString();
    const next: Task = { ...current, ...patch, updatedAt: now };
    if (patch.status && patch.status !== current.status) {
      if (patch.status === 'done') {
        next.completedAt = now;
      } else {
        delete next.completedAt;
      }
    }
    await this.write(next);
    return next;
  }

  async addLinks(id: string, links: TaskLink[]): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }
    const key = (l: TaskLink) => `${l.path}|${l.line ?? ''}|${l.endLine ?? ''}`;
    const seen = new Set(task.links.map(key));
    const merged = [...task.links, ...links.filter((l) => !seen.has(key(l)))];
    return this.update(id, { links: merged });
  }

  async delete(id: string): Promise<void> {
    const dir = this.dir;
    if (!dir) {
      return;
    }
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, `${id}.json`));
    } catch {
      // already gone
    }
    this.tasks.delete(id);
    this.emitter.fire();
  }

  // ---- links ----

  /** Workspace-relative path with forward slashes ('' for the root); undefined if outside the workspace. */
  relativePath(uri: vscode.Uri): string | undefined {
    const root = this.root;
    if (!root || uri.scheme !== 'file') {
      return undefined;
    }
    const rel = path.relative(root.fsPath, uri.fsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return undefined;
    }
    return rel.split(path.sep).join('/');
  }

  /** Builds a link for a file/folder inside the workspace; undefined if it's outside. */
  async makeLink(uri: vscode.Uri, range?: { line: number; endLine?: number }): Promise<TaskLink | undefined> {
    const relative = this.relativePath(uri);
    if (relative === undefined) {
      return undefined;
    }
    let kind: TaskLink['kind'] = 'file';
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        kind = 'folder';
      }
    } catch {
      // keep 'file'
    }
    const link: TaskLink = { path: relative || '.', kind };
    if (kind === 'file' && range) {
      link.line = range.line;
      if (range.endLine && range.endLine !== range.line) {
        link.endLine = range.endLine;
      }
    }
    return link;
  }

  uriOf(link: TaskLink): vscode.Uri {
    const root = this.root ?? vscode.Uri.file('/');
    return vscode.Uri.joinPath(root, ...link.path.split('/'));
  }

  // ---- internals ----

  private async write(task: Task): Promise<void> {
    const dir = this.dir;
    if (!dir) {
      throw new Error('Task Board needs an open folder.');
    }
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, `${task.id}.json`),
      Buffer.from(serializeTask(task), 'utf8')
    );
    this.tasks.set(task.id, task);
    this.emitter.fire();
  }

  private scheduleReload(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reload(), 250);
  }

  private async resolveAuthor(): Promise<string> {
    const configured = vscode.workspace.getConfiguration('taskBoard').get<string>('author')?.trim();
    if (configured) {
      return configured;
    }
    const cwd = this.root?.fsPath;
    const gitName = await new Promise<string>((resolve) => {
      execFile('git', ['config', 'user.name'], { cwd, timeout: 3000 }, (err, stdout) =>
        resolve(err ? '' : String(stdout).trim())
      );
    });
    return gitName || os.userInfo().username;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}
