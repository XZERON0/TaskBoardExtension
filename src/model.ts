export type TaskType = 'fix' | 'refactor' | 'feature' | 'docs' | 'test' | 'idea';
export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export type SortMode = 'newest' | 'oldest' | 'updated' | 'priority' | 'title' | 'type';

export interface TaskLink {
  /** Path relative to the workspace root, always with forward slashes. */
  path: string;
  kind: 'file' | 'folder';
  line?: number;
  endLine?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  author: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  links: TaskLink[];
}

// All user-facing labels live here, so translating the UI is a one-file job.
export const TYPE_META: Record<TaskType, { label: string; icon: string }> = {
  fix: { label: 'Fix', icon: 'bug' },
  refactor: { label: 'Refactor', icon: 'tools' },
  feature: { label: 'Feature', icon: 'sparkle' },
  docs: { label: 'Docs', icon: 'book' },
  test: { label: 'Test', icon: 'beaker' },
  idea: { label: 'Idea', icon: 'lightbulb' },
};

export const STATUS_META: Record<TaskStatus, { label: string; icon: string; color: string }> = {
  todo: { label: 'Not started', icon: 'circle-outline', color: 'descriptionForeground' },
  'in-progress': { label: 'In progress', icon: 'sync', color: 'charts.yellow' },
  done: { label: 'Done', icon: 'pass', color: 'charts.green' },
};

export const PRIORITY_META: Record<Priority, { label: string }> = {
  high: { label: 'High' },
  medium: { label: 'Medium' },
  low: { label: 'Low' },
};

export const SORT_META: Record<SortMode, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  updated: 'Recently updated',
  priority: 'Priority',
  title: 'Title (A-Z)',
  type: 'Type',
};

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in-progress', 'done'];

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function sortTasks(list: Task[], mode: SortMode): Task[] {
  const byNewest = (a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt);
  const out = [...list];
  switch (mode) {
    case 'oldest': return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'updated': return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'priority': return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byNewest(a, b));
    case 'title': return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'type': return out.sort((a, b) => a.type.localeCompare(b.type) || byNewest(a, b));
    default: return out.sort(byNewest);
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback;
}

/** Validates data read from disk (it may be hand-edited or come from a git merge). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeTask(raw: any, fallbackId: string): Task | undefined {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') {
    return undefined;
  }
  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links: TaskLink[] = Array.isArray(raw.links)
    ? raw.links
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((l: any) => l && typeof l.path === 'string')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((l: any): TaskLink => ({
          path: l.path,
          kind: l.kind === 'folder' ? 'folder' : 'file',
          ...(Number.isInteger(l.line) ? { line: l.line } : {}),
          ...(Number.isInteger(l.endLine) ? { endLine: l.endLine } : {}),
        }))
    : [];
  const task: Task = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId,
    title: raw.title,
    description: typeof raw.description === 'string' ? raw.description : '',
    type: oneOf(raw.type, Object.keys(TYPE_META) as TaskType[], 'feature'),
    status: oneOf(raw.status, STATUS_ORDER, 'todo'),
    priority: oneOf(raw.priority, ['low', 'medium', 'high'] as Priority[], 'medium'),
    author: typeof raw.author === 'string' ? raw.author : 'unknown',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    links,
  };
  if (typeof raw.completedAt === 'string') {
    task.completedAt = raw.completedAt;
  }
  return task;
}

/** Fixed key order keeps git diffs small and readable. */
export function serializeTask(t: Task): string {
  const ordered = {
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    priority: t.priority,
    author: t.author,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(t.completedAt ? { completedAt: t.completedAt } : {}),
    links: t.links,
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}
