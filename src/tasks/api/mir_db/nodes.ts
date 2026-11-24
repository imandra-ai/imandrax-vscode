import type { ProofObligationResult } from 'imandrax-api';
import type { Declaration, Uid } from 'imandrax-api/dist/mir';
import type { DecompositionTask, ProofObligation, ProofObligationTask, TaskResult } from 'imandrax-api/dist/tasks';
import type { Report } from 'imandrax-api/dist/report';
import { ApiSession, errorText } from '../client';
import { MirFormat, MirRenderer } from '../mir_format';
import { decompDocument, outcome, poDocument, terminationText } from '../report_printer';
import { at, byName, DbIndex, headText, measureText } from './db_index';

// The MIR DB view's nodes: a task (with its reports and, once its DB is loaded, groups of declarations),
// a group, a declaration, a PO's or decomposition's report, or why the DB could not be loaded
export type Node = TaskNode | GroupNode | DeclNode | ReportNode | MessageNode;
// A task with what its caller already knows: a check's PO results carry their origin and verdict
export type Run = { task: DecompositionTask } | ProofObligationResult;
type DbTask = DecompositionTask | ProofObligationTask;

export class TaskNode {
  private static count = 0;
  readonly id = `mirdb-task-${TaskNode.count++}`;
  readonly ids: ReadonlySet<string>;
  // Names the file's text defines: MIR decls carry no source location.
  // ponytail: a top-level parse (imlformat's iml2json) would be exact if local `let`s ever mislead this
  readonly defined: ReadonlySet<string>;
  time = new Date();
  children?: Node[]; // the reports and groups, once loaded
  // Per PO (under one group) or the decomposition: they need no DB
  readonly reports: readonly (GroupNode | ReportNode)[];
  ready?: DbIndex; // once loaded, for printing reports
  private index?: Promise<DbIndex>;
  private readonly task: DbTask;

  constructor(readonly label: string, runs: readonly Run[], source: string, readonly session: ApiSession) {
    this.ids = new Set(runs.map(r => r.task.id.toString()));
    this.task = runs[runs.length - 1].task;
    this.reports = runs.some(r => 'origin' in r)
      ? [new GroupNode(this, 'Proof obligations', runs.length, g => runs.map(r => new ReportNode(g, this, r)))]
      : runs.map(r => new ReportNode(this, this, r));
    this.defined = new Set([...source.matchAll(
      /\b(?:let(?:\s+rec)?|and|type|theorem|lemma|axiom|rule|instance|verify)\s+([A-Za-z_][\w']*)/g)].map(m => m[1]));
  }

  // A failed or timed out fetch is not kept, so expanding again (or Retry) refetches
  load(): Promise<DbIndex> {
    this.index ??= this.session.fetch(this.task, 'the MIR DB', async () => (this.ready = new DbIndex(await this.task.db())));
    this.index.catch(() => { this.index = undefined; });
    return this.index;
  }

  private reportNodes(): ReportNode[] {
    return this.reports.flatMap(n => (n instanceof GroupNode ? n.items() : [n])).filter(n => n instanceof ReportNode);
  }

  // How `uid` was admitted, from its termination PO if this check ran it: a PO named like it whose goal is
  // `terminates` of exactly this function (not a shadowed or library one of the same name)
  async termination(uid: Uid, mir: MirRenderer): Promise<string | undefined> {
    try {
      for (const n of this.reportNodes().filter(r => r.fromSym === uid.shortName)) {
        const text = await n.termination(uid, mir);
        if (text) { return text; }
      }
    } catch (e) {
      return `could not load its termination PO: ${errorText(e)}`;
    }
  }

  // Verdicts of POs named like a recursive function, by name; termination() checks the full id when opened
  // ponytail: a file redefining a recursive function shows the same verdict on both
  terminationPOs(): Map<string, string> {
    return new Map(this.reportNodes().flatMap(n => (n.fromSym ? [[n.fromSym, `termination PO ${n.description}`] as const] : [])));
  }
}

// A PO's or decomposition's result and report, fetched when first opened
export class ReportNode {
  private fetched?: Promise<{ po?: ProofObligation; res: TaskResult; report: Report }>;
  constructor(readonly parent: Node, readonly task: TaskNode, readonly run: Run) { }
  get fromSym() { return 'origin' in this.run ? this.run.origin.fromSym : undefined; }
  get label() { return 'origin' in this.run ? `${this.run.origin.fromSym}${this.run.origin.count ? ` #${this.run.origin.count}` : ''}` : 'Decomposition'; }
  get description() { return 'origin' in this.run ? outcome(this.run) : 'report'; }
  get taskId() { return this.run.task.id.toString(); }

  async document(f: MirFormat): Promise<string> {
    const { po, res, report } = await this.fetch();
    const mir = this.task.ready?.renderer(f) ?? new MirRenderer(f);
    if ('origin' in this.run && po && res.kind === 'checkPo') { return poDocument(this.run, po, res, report, mir); }
    return res.kind === 'decomp' ? decompDocument(res, report, mir) : mir.document([mir.note(`Unexpected ${res.kind} result`)]);
  }

  // How it went, if it is the termination PO of `uid`
  async termination(uid: Uid, mir: MirRenderer): Promise<string | undefined> {
    const { po, report } = await this.fetch();
    const goal = po?.goal.body;
    const about = goal?.kind === 'apply' && goal.function.kind === 'symbol' && goal.function.symbol.id.shortName === 'terminates'
      && goal.arguments.some(a => a.kind === 'symbol' && a.symbol.id.equals(uid));
    return 'origin' in this.run && po && about ? terminationText(this.run, po, report, mir) : undefined;
  }

  // A failed or timed out fetch is not kept
  private fetch() {
    const r = this.run;
    this.fetched ??= this.task.session.fetch(r.task, 'the report', async () => {
      const [po, res] = await Promise.all(['origin' in r ? r.task.proofObligation() : undefined, r.task.result()]);
      return { po, res, report: await res.report() };
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
  // Measures from definitions, and functions whose termination PO this check ran
  const terminating = new Map(idx.measured().map(([u, a]) => [u.fullName, [u, measureText(a) || 'default measure']] as const));
  const termPOs = task.terminationPOs();
  for (const d of decls) {
    const rec = d.kind === 'function' && mine(d) && [...d.function.clique ?? []].some(u => u.equals(d.id));
    const po = rec ? termPOs.get(d.id.shortName) : undefined;
    const m = terminating.get(d.id.fullName)?.[1];
    if (po) { terminating.set(d.id.fullName, [d.id, m ? `${m}, ${po}` : po]); }
  }
  return [
    ...group(task, 'This file', declItems(decls.filter(mine))),
    ...group(task, 'Library', declItems(decls.filter(d => !mine(d)))),
    ...group(task, 'Rules', rules),
    ...group(task, 'Termination', [...terminating.values()].sort((a, b) => byName(a[0], b[0]))),
    ...group(task, 'Disabled', [...idx.db.disabled].sort(byName).map(u => [u, ''] as const)),
  ];
}
