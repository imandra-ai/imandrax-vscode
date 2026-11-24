import {
  commands, Disposable, EventEmitter, Hover, languages, MarkdownString, ThemeIcon, TreeDataProvider, TreeItem,
  TreeItemCollapsibleState, TreeView, Uri, ViewColumn, window, workspace,
} from 'vscode';
import type { Admission, DB, Declaration, PatternHead, Uid } from 'imandrax-api/dist/mir';
import type { ProofObligationResult } from 'imandrax-api';
import type { DecompositionTask, ProofObligation, ProofObligationTask, TaskResult } from 'imandrax-api/dist/tasks';
import type { Report } from 'imandrax-api/dist/report';
import { connect, errorText, TIMEOUT_MS } from './client';
import { noHashes, printDeclaration } from './mir_printer';
import { comment, decompDocument, outcome, poDocument, terminationText } from './report_printer';

// [taskId]: reveals and expands the node of the task (regions webview link, code action, notification)
export const REVEAL_COMMAND = 'imandrax.mirDb.reveal';
const VIEW_ID = 'imandrax.mirDb';
const SCHEME = 'imandrax-mirdb'; // read-only declaration documents
const MAX_TASKS = 10;

type DbTask = DecompositionTask | ProofObligationTask;
type Printed = ReturnType<typeof printDeclaration>;
type Node = TaskNode | GroupNode | DeclNode | ReportNode | MessageNode;
// A task with what its caller already knows: a check's PO results carry their origin and verdict
export type Run = { task: DecompositionTask } | ProofObligationResult;

// The view "ImandraX MIR DB": recent API tasks (newest first), each with what its MIR DB holds beyond
// the file's own declarations. A task's DB is fetched when its node is first expanded and kept on the
// node until the node leaves the list. A declaration opens as readable IML in a read-only document,
// with its rules, termination measure and users; hovering a name there shows its full ids (with hashes).
// Each PO (or the decomposition) opens as a report: verdict, goal, counterexample, proof and the prover's steps.
export class MirDbView implements TreeDataProvider<Node>, Disposable {
  private nodes: TaskNode[] = [];
  private readonly changed = new EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: TreeView<Node> = window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
  // Open declaration documents, by URI
  private readonly docs = new Map<string, { node: DeclNode | ReportNode; fullIds?: ReadonlyMap<string, readonly string[]> }>();
  private readonly subscriptions = [
    this.view, this.changed,
    commands.registerCommand(REVEAL_COMMAND, (id: string) => this.reveal(id)),
    commands.registerCommand('imandrax.mirDb.open', (n: DeclNode | ReportNode) => this.open(n)),
    commands.registerCommand('imandrax.mirDb.retry', (n: TaskNode) => this.changed.fire(n)),
    commands.registerCommand('imandrax.mirDb.clear', () => { this.nodes = []; this.changed.fire(undefined); }),
    workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => this.content(uri) }),
    workspace.onDidCloseTextDocument(doc => this.docs.delete(doc.uri.toString())),
    languages.registerHoverProvider({ scheme: SCHEME }, {
      provideHover: (doc, pos) => {
        const range = doc.getWordRangeAtPosition(pos, /[^\s()[\];,]+/);
        const ids = range && this.docs.get(doc.uri.toString())?.fullIds?.get(doc.getText(range));
        return ids && new Hover(new MarkdownString().appendCodeblock(ids.join('\n'), 'text'), range);
      },
    }),
  ];

  // `label` like "decompose fee"; `source`: the file's text, for "This file". The DB is the last task's:
  // ponytail: a file's later POs see a superset of the earlier ones' DBs, so one fetch covers a whole check
  add(label: string, runs: readonly Run[], source: string): string | undefined {
    const tasks = runs.map(r => r.task);
    const task = tasks.at(-1);
    if (!task) { return; }
    const id = task.id.toString();
    const old = this.nodes.find(n => n.ids.has(id)); // content-addressed: the same work again keeps its DB
    const node = old?.label === label && tasks.every(t => old.ids.has(t.id.toString())) ? old : new TaskNode(label, runs, source);
    node.time = new Date();
    this.nodes = [node, ...this.nodes.filter(n => n !== node)].slice(0, MAX_TASKS);
    this.changed.fire(undefined);
    return id;
  }

  has(taskId: string) { return this.nodes.some(n => n.ids.has(taskId)); }

  async reveal(taskId: string) {
    const node = this.nodes.find(n => n.ids.has(taskId));
    if (!node) {
      void window.showInformationMessage('That task is no longer in the ImandraX MIR DB view; run it again.');
      return;
    }
    await this.view.reveal(node, { select: true, focus: true, expand: true });
  }

  getTreeItem(n: Node): TreeItem {
    const item = new TreeItem(n.label, n instanceof TaskNode || n instanceof GroupNode
      ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None);
    item.id = nodeId(n);
    if (n instanceof TaskNode) {
      item.description = n.time.toLocaleTimeString();
      item.tooltip = [...n.ids].join('\n');
      item.iconPath = new ThemeIcon('database');
    } else if (n instanceof GroupNode) {
      item.description = String(n.count);
    } else if (n instanceof DeclNode || n instanceof ReportNode) {
      item.description = n.description;
      item.command = { title: 'Open', command: 'imandrax.mirDb.open', arguments: [n] };
    } else {
      item.iconPath = new ThemeIcon('error');
      item.command = { title: 'Retry', command: 'imandrax.mirDb.retry', arguments: [n.parent] };
    }
    return item;
  }

  getParent(n: Node) { return n instanceof TaskNode ? undefined : n.parent; }

  async getChildren(n?: Node): Promise<Node[]> {
    if (!n) { return this.nodes; }
    if (n instanceof GroupNode) { return n.items(); }
    if (!(n instanceof TaskNode)) { return []; }
    if (n.children) { return n.children; }
    try {
      const index = await window.withProgress({ location: { viewId: VIEW_ID }, title: 'Loading MIR DB' }, () => n.load());
      n.children = [...n.reports, ...groups(n, index)];
      return n.children;
    } catch (e) {
      return [...n.reports, new MessageNode(n, `Could not load the MIR DB (click to retry): ${errorText(e)}`)];
    }
  }

  // A report's label is unique in its task; a declaration's short name may not be
  private async open(n: DeclNode | ReportNode) {
    const [name, uid] = n instanceof DeclNode ? [n.uid.shortName, { uid: n.uid.fullName }] : [`${n.label} report`, {}];
    const uri = Uri.from({ scheme: SCHEME, path: `/${name.replace(/\//g, '∕')}.iml`,
      query: new URLSearchParams({ task: n.task.id, ...uid }).toString() });
    // An open document keeps its entry: VS Code won't ask for its content (and full ids) again
    const key = uri.toString();
    const added = !this.docs.has(key);
    if (added) { this.docs.set(key, { node: n }); }
    let doc;
    try {
      doc = await workspace.openTextDocument(uri);
    } catch (e) {
      if (added) { this.docs.delete(key); }
      throw e;
    }
    if (doc.languageId !== 'imandrax') { doc = await languages.setTextDocumentLanguage(doc, 'imandrax'); }
    await window.showTextDocument(doc, { viewColumn: ViewColumn.Beside, preview: true, preserveFocus: true });
  }

  private async content(uri: Uri): Promise<string> {
    const entry = this.docs.get(uri.toString());
    if (!entry || !this.nodes.includes(entry.node.task)) { return '(* No longer in the ImandraX MIR DB view: open it from there again *)\n'; }
    const { node } = entry;
    if (node instanceof ReportNode) { return node.document().catch((e: unknown) => comment(`Could not load the report: ${errorText(e)}`)); }
    try {
      const index = await node.task.load();
      const { text, fullIds } = index.document(node.uid, await node.task.termination(node.uid));
      entry.fullIds = fullIds;
      return text;
    } catch (e) {
      return comment(`Could not show ${node.uid.shortName}: ${errorText(e)}`);
    }
  }

  dispose() { for (const d of this.subscriptions) { d.dispose(); } }
}

class TaskNode {
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

  constructor(readonly label: string, runs: readonly Run[], source: string) {
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
    this.index ??= fetching(this.task, 'the MIR DB', async () => (this.ready = new DbIndex(await this.task.db())));
    this.index.catch(() => { this.index = undefined; });
    return this.index;
  }

  private reportNodes(): ReportNode[] {
    return this.reports.flatMap(n => (n instanceof GroupNode ? n.items() : [n])).filter(n => n instanceof ReportNode);
  }

  // How `uid` was admitted, from its termination PO if this check ran it: a PO named like it whose goal is
  // `terminates` of exactly this function (not a shadowed or library one of the same name)
  async termination(uid: Uid): Promise<string | undefined> {
    try {
      for (const n of this.reportNodes().filter(r => r.fromSym === uid.shortName)) {
        const text = await n.termination(uid);
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

// Fetches on a task, chained: each sets the task's client (the last PO's task serves both the DB and its report)
const queues = new WeakMap<DbTask, Promise<unknown>>();

// `f` (which uses `task`) with a fresh client, within TIMEOUT_MS: the task's session is closed; artifacts outlive it
function fetching<T>(task: DbTask, what: string, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(task) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const timedOut = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => { reject(new Error(`timed out loading ${what}`)); }, { once: true });
    });
    timedOut.catch(() => undefined); // also when connect fails first
    const client = await Promise.race([connect(signal), timedOut]);
    try {
      task.setClient(client);
      return await Promise.race([f(), timedOut]);
    } finally {
      void client.close().catch(() => undefined); // a hung close must not hold up the result or the next fetch
    }
  });
  queues.set(task, run);
  return run;
}

// A PO's or decomposition's result and report, fetched when first opened
class ReportNode {
  private fetched?: Promise<{ po?: ProofObligation; res: TaskResult; report: Report }>;
  constructor(readonly parent: Node, readonly task: TaskNode, readonly run: Run) { }
  get fromSym() { return 'origin' in this.run ? this.run.origin.fromSym : undefined; }
  get label() { return 'origin' in this.run ? `${this.run.origin.fromSym}${this.run.origin.count ? ` #${this.run.origin.count}` : ''}` : 'Decomposition'; }
  get description() { return 'origin' in this.run ? outcome(this.run) : 'report'; }
  get taskId() { return this.run.task.id.toString(); }

  async document(): Promise<string> {
    const { po, res, report } = await this.fetch();
    const db = this.task.ready?.db;
    if ('origin' in this.run && po && res.kind === 'checkPo') { return poDocument(this.run, po, res, report, db); }
    return res.kind === 'decomp' ? decompDocument(res, report, db) : comment(`Unexpected ${res.kind} result`);
  }

  // How it went, if it is the termination PO of `uid`
  async termination(uid: Uid): Promise<string | undefined> {
    const { po, report } = await this.fetch();
    const goal = po?.goal.body;
    const about = goal?.kind === 'apply' && goal.function.kind === 'symbol' && goal.function.symbol.id.shortName === 'terminates'
      && goal.arguments.some(a => a.kind === 'symbol' && a.symbol.id.equals(uid));
    return 'origin' in this.run && po && about ? terminationText(this.run, po, report, this.task.ready?.db) : undefined;
  }

  // A failed or timed out fetch is not kept
  private fetch() {
    const r = this.run;
    this.fetched ??= fetching(r.task, 'the report', async () => {
      const [po, res] = await Promise.all(['origin' in r ? r.task.proofObligation() : undefined, r.task.result()]);
      return { po, res, report: await res.report() };
    });
    this.fetched.catch(() => { this.fetched = undefined; });
    return this.fetched;
  }
}

class GroupNode {
  private nodes?: Node[];
  constructor(readonly parent: Node, readonly label: string, readonly count: number, private readonly make: (self: GroupNode) => Node[]) { }
  items() { this.nodes ??= this.make(this); return this.nodes; }
}

class DeclNode {
  constructor(readonly parent: Node, readonly task: TaskNode, readonly uid: Uid, readonly description: string) { }
  get label() { return this.uid.shortName; }
}

class MessageNode {
  constructor(readonly parent: TaskNode, readonly label: string) { }
}

// A rule of the DB: what kind, from which theorem (or rule spec / instantiation rule), on which pattern head
interface Rule { kind: string; source: Uid; head: PatternHead | undefined }

const headText = (h: PatternHead | undefined) =>
  h?.kind === 'symbol' ? h.uid.shortName : h?.kind === 'type' ? noHashes(h.type.toString()) : h?.toString() ?? '';
const ruleText = (r: Rule) => r.head ? `${r.kind} on ${headText(r.head)}` : r.kind;
const measureText = (a: Admission) =>
  [a.measuredSubset.length ? `measured: ${a.measuredSubset.join(' ')}` : '', a.measureFunction ? `measure: ${a.measureFunction.shortName}` : '']
    .filter(Boolean).join(', ');
const byName = (a: Uid, b: Uid) => a.shortName.localeCompare(b.shortName);
// `m`'s value at `k`, set to `init()` first if missing
function at<K, V>(m: Map<K, V>, k: K, init: () => V): V {
  const v = m.get(k) ?? init();
  m.set(k, v);
  return v;
}

// Unique in the tree: the same declaration can show in several groups
const nodeId = (n: Node): string => (n instanceof TaskNode ? n.id
  : `${nodeId(n.parent)}/${n instanceof DeclNode ? n.uid.fullName : n instanceof ReportNode ? `${n.label} ${n.taskId}` : n.label}`);

// The DB's tables index the same rules differently (rwRules by head, thmAsRw by theorem, fc and gen point
// into instRules): a table only adds the (kind, source) pairs no earlier one had
function rulesOf(db: DB): Rule[] {
  type Row = readonly [string, Uid, readonly (PatternHead | undefined)[]];
  const out: Rule[] = [];
  const seen = new Set<string>();
  const key = (kind: string, u: Uid) => `${kind} ${u.fullName}`;
  const table = (rows: Row[]) => {
    const fresh = rows.filter(([kind, u]) => !seen.has(key(kind, u)));
    for (const [kind, source, heads] of fresh) { for (const head of heads.length ? heads : [undefined]) { out.push({ kind, source, head }); } }
    for (const [kind, u] of fresh) { seen.add(key(kind, u)); }
  };
  const instKind = (k: string) => (k === 'forwardChaining' ? 'forward chaining' : 'generalization');
  table([...db.rwRules].flatMap(([h, rs]) => rs.map((r): Row => ['rewrite', r.name, [h]])));
  table([...db.instRules].map(([u, r]): Row => [instKind(r.kind), u, r.triggers.map(t => t.head)]));
  table([...db.elim].flatMap(([h, es]) => es.map((e): Row => ['elimination', e.name, [h]])));
  table([...db.fc].flatMap(([h, ts]) => ts.map((t): Row => ['forward chaining', t.instantiationRuleName, [h]])));
  table([...db.gen].flatMap(([h, ts]) => ts.map((t): Row => ['generalization', t.instantiationRuleName, [h]])));
  table([...db.thmAsRw, ...db.ruleSpecRwRules].map(([u, rs]): Row => ['rewrite', u, rs.map(r => r.head)]));
  table([...db.thmAsFc].map(([u, rs]): Row => ['forward chaining', u, rs.flatMap(r => r.triggers.map(t => t.head))]));
  table([...db.ruleSpecFc].map(([u, ts]): Row => ['forward chaining', u, ts.map(t => t.head)]));
  table([...db.thmAsElim].map(([u, es]): Row => ['elimination', u, es.map(() => undefined)]));
  table([...db.thmAsGen].map(([u, r]): Row => ['generalization', u, r.triggers.map(t => t.head)]));
  return out;
}

// Groups under a task: non-empty ones only
function groups(task: TaskNode, idx: DbIndex): Node[] {
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

// A fetched DB and what the view derives from it, each computed on first use
class DbIndex {
  readonly rules: readonly Rule[];
  private readonly printed = new Map<string, Printed>();
  private users?: Map<string, Uid[]>;

  constructor(readonly db: DB) { this.rules = rulesOf(db); }

  // Functions with a termination measure: the DB's admissions, and those in definitions' hints
  measured(): [Uid, Admission][] {
    const out = new Map<string, [Uid, Admission]>();
    for (const d of this.db.decls.values()) {
      if (d.kind === 'function' && d.function.hints.admission) { out.set(d.id.fullName, [d.id, d.function.hints.admission]); }
    }
    for (const [u, a] of this.db.admission) { out.set(u.fullName, [u, a]); }
    return [...out.values()];
  }

  // The declaration's IML, then the rules from or about it, its termination measure and its users
  // `termination`: how its termination PO went, if this task has it
  document(uid: Uid, termination?: string): Printed {
    const ids = new Map<string, Set<string>>();
    const reg = (p: Printed) => {
      for (const [k, vs] of p.fullIds) { vs.forEach(v => at(ids, k, () => new Set()).add(v)); }
      return p.text;
    };
    const name = (u: Uid) => reg({ text: u.shortName, fullIds: new Map([[u.shortName, [u.fullName]]]) });
    const decl = this.db.findDeclaration(uid);
    const parts = [decl ? reg(this.print(decl)) : `(* ${name(uid)} is not a declaration of this DB *)`];

    const measure = this.db.admission.get(uid) ?? (decl?.kind === 'function' ? decl.function.hints.admission : undefined);
    const rec = decl?.kind === 'function' && decl.function.clique !== undefined && [...decl.function.clique].some(u => u.equals(uid));
    const how = [measure && `[@@measure] ${measureText(measure) || 'default'}`, termination].filter(Boolean);
    if (how.length || rec) {
      // ponytail: without [@@measure] the DB has no admission; the default measure only shows in the PO's SMT proof
      parts.push(comment(`Termination: ${how.join('\n') || 'no [@@measure], and its termination PO is not in this task (check the file to see it)'}`));
    }

    // The same rule shows in several of the DB's tables (e.g. rwRules and thmAsRw)
    const rules = [...new Map(this.rules
      .filter(r => r.source.equals(uid) || (r.head?.kind === 'symbol' && r.head.uid.equals(uid)))
      .map(r => [`${r.kind} ${r.source.fullName} ${headText(r.head)}`, r])).values()];
    const own = rules.filter(r => r.source.equals(uid));
    if (own.length) { parts.push(`(* As rules: ${own.map(ruleText).join('; ')} *)`); }
    const bySource = new Map<string, Rule[]>();
    for (const r of rules.filter(x => !x.source.equals(uid))) { at(bySource, r.source.fullName, () => []).push(r); }
    if (bySource.size) {
      parts.push(`(* Rules about ${name(uid)} *)`);
      for (const rs of bySource.values()) {
        const src = this.db.findDeclaration(rs[0].source);
        parts.push(`(* ${rs.map(ruleText).join('; ')}, from ${name(rs[0].source)} *)${src ? `\n${reg(this.print(src))}` : ''}`);
      }
    }

    const users = this.usedBy(uid).sort(byName);
    const rows = Array.from({ length: Math.ceil(users.length / 6) }, (_, i) => users.slice(i * 6, i * 6 + 6).map(name).join(', '));
    parts.push(users.length ? `(* Used by (${users.length}):\n   ${rows.join(',\n   ')} *)` : '(* Used by: nothing in this DB *)');
    return { text: `${parts.join('\n\n')}\n`, fullIds: new Map([...ids].map(([k, v]) => [k, [...v]])) };
  }

  private print(d: Declaration): Printed {
    let p = this.printed.get(d.id.fullName);
    if (!p) { this.printed.set(d.id.fullName, (p = printDeclaration(d, this.db))); }
    return p;
  }

  // Declarations whose printed IML names `uid` (lifted lambdas count for the declarations they are inlined in)
  private usedBy(uid: Uid): Uid[] {
    if (!this.users) {
      this.users = new Map();
      for (const d of this.db.decls.values()) {
        if (d.id.shortName.startsWith('$lambda')) { continue; }
        for (const full of new Set([...this.print(d).fullIds.values()].flat())) {
          if (full !== d.id.fullName) { at(this.users, full, () => []).push(d.id); }
        }
      }
    }
    return [...this.users.get(uid.fullName) ?? []];
  }
}
