import type { Declaration, Uid } from 'imandrax-api/dist/mir';
import type { DecompositionTask, DecompositionTaskResult } from 'imandrax-api/dist/tasks';
import type { Report } from 'imandrax-api/dist/report';
import { ApiSession } from '../client';
import { MirFormat, MirRenderer } from '../mir_format';
import { decompDocument } from '../report_printer';
import { at, byName, DbIndex, headText, measureText } from './db_index';

// The MIR DB view's nodes: a decomposition task (with its report and, once its DB is loaded, groups of
// declarations), a group, a declaration, the decomposition's report, or why the DB could not be loaded
export type Node = TaskNode | GroupNode | DeclNode | ReportNode | MessageNode;

export class TaskNode {
  private static count = 0;
  readonly id = `mirdb-task-${TaskNode.count++}`;
  readonly taskId: string;
  // Names the file's text defines: MIR decls carry no source location.
  // ponytail: a top-level parse (imlformat's iml2json) would be exact if local `let`s ever mislead this
  readonly defined: ReadonlySet<string>;
  time = new Date();
  children?: Node[]; // the report and groups, once loaded
  readonly report: ReportNode; // needs no DB
  ready?: DbIndex; // once loaded, for printing the report
  private index?: Promise<DbIndex>;

  constructor(readonly label: string, private readonly task: DecompositionTask, source: string, readonly session: ApiSession) {
    this.taskId = task.id.toString();
    this.report = new ReportNode(this, task);
    this.defined = new Set([...source.matchAll(
      /\b(?:let(?:\s+rec)?|and|type|theorem|lemma|axiom|rule|instance|verify)\s+([A-Za-z_][\w']*)/g)].map(m => m[1]));
  }

  // A failed or timed out fetch is not kept, so expanding again (or Retry) refetches
  load(): Promise<DbIndex> {
    this.index ??= this.session.fetch(this.task, 'the MIR DB', async () => (this.ready = new DbIndex(await this.task.db())));
    this.index.catch(() => { this.index = undefined; });
    return this.index;
  }
}

// The decomposition's result and report, fetched when first opened
export class ReportNode {
  readonly label = 'Decomposition';
  readonly description = 'report';
  private fetched?: Promise<{ res: DecompositionTaskResult; report: Report }>;
  constructor(readonly task: TaskNode, private readonly decomposition: DecompositionTask) { }
  get parent() { return this.task; }

  async document(f: MirFormat): Promise<string> {
    const { res, report } = await this.fetch();
    return decompDocument(res, report, this.task.ready?.renderer(f) ?? new MirRenderer(f));
  }

  // A failed or timed out fetch is not kept
  private fetch() {
    this.fetched ??= this.task.session.fetch(this.decomposition, 'the report', async () => {
      const res = await this.decomposition.result();
      return { res, report: await res.report() };
    });
    this.fetched.catch(() => { this.fetched = undefined; });
    return this.fetched;
  }
}

export class GroupNode {
  private nodes?: Node[];
  constructor(readonly parent: Node, readonly label: string, readonly count: number, private readonly make: (self: GroupNode) => Node[]) { }
  items() { this.nodes ??= this.make(this); return this.nodes; }
}

export class DeclNode {
  constructor(readonly parent: Node, readonly task: TaskNode, readonly uid: Uid, readonly description: string) { }
  get label() { return this.uid.shortName; }
}

export class MessageNode {
  constructor(readonly parent: TaskNode, readonly label: string) { }
}

// Groups under a task: non-empty ones only
export function groups(task: TaskNode, idx: DbIndex): Node[] {
  const group = (parent: Node, label: string, items: readonly (readonly [Uid, string])[]) => items.length
    ? [new GroupNode(parent, label, items.length, g => items.map(([u, d]) => new DeclNode(g, task, u, d)))] : [];
  const decls = [...idx.db.decls.values()].sort((a, b) => byName(a.id, b.id));
  const declItems = (ds: Declaration[]) => ds.map(d => [d.id, d.kind] as const);
  // `verify`/`instance` decls (`_verify_3_8`) are unnamed in the source; the library's are in modules
  const mine = (d: Declaration) => (d.kind === 'verify' && !d.id.shortName.includes('.')) || task.defined.has(d.id.shortName);
  // One leaf per rule source (theorem, rule spec or instantiation rule), described by all its roles
  const roles = new Map<string, [Uid, Map<string, Set<string>>]>();
  for (const r of idx.rules) {
    at(at(roles, r.source.fullName, (): [Uid, Map<string, Set<string>>] => [r.source, new Map<string, Set<string>>()])[1], r.kind, () => new Set<string>()).add(headText(r.head));
  }
  const rules = [...roles.values()].sort((a, b) => byName(a[0], b[0])).map(([u, kinds]) => [u, [...kinds].map(([kind, heads]) => {
    const hs = [...heads].filter(Boolean);
    return hs.length ? `${kind} on ${hs.join(', ')}` : kind;
  }).join('; ')] as const);
  // Measures from definitions
  const terminating = idx.measured().map(([u, a]) => [u, measureText(a) || 'default measure'] as const);
  return [
    ...group(task, 'This file', declItems(decls.filter(mine))),
    ...group(task, 'Library', declItems(decls.filter(d => !mine(d)))),
    ...group(task, 'Rules', rules),
    ...group(task, 'Termination', terminating.sort((a, b) => byName(a[0], b[0]))),
    ...group(task, 'Disabled', [...idx.db.disabled].sort(byName).map(u => [u, ''] as const)),
  ];
}
