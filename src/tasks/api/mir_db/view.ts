import {
  commands, Disposable, EventEmitter, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeView, Uri, window,
} from 'vscode';
import { ApiSession, errorText } from '../client';
import { MirDbDocuments } from './documents';
import { DeclNode, GroupNode, groups, MessageNode, Node, ReportNode, Run, TaskNode } from './nodes';
import { REVEAL_COMMAND } from './reveal';

const VIEW_ID = 'imandrax.mirDb';
const MAX_TASKS = 10;

// The view "ImandraX MIR DB": recent API tasks (newest first), each with what its MIR DB holds beyond
// the file's own declarations. A task's DB is fetched when its node is first expanded and kept on the
// node until the node leaves the list. A declaration opens as readable IML (or MIR, or raw JSON) in a read-only document
// (MirDbDocuments); each PO (or the decomposition) opens as a report: verdict, goal, counterexample,
// proof and the prover's steps.
export class MirDbView implements TreeDataProvider<Node>, Disposable {
  private nodes: TaskNode[] = [];
  private readonly changed = new EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: TreeView<Node> = window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
  private readonly documents = new MirDbDocuments(task => this.nodes.includes(task));
  private readonly subscriptions = [
    this.view, this.changed, this.documents,
    commands.registerCommand(REVEAL_COMMAND, (id: string) => this.reveal(id)),
    commands.registerCommand('imandrax.mirDb.open', (n: DeclNode | ReportNode) => this.documents.open(n)),
    commands.registerCommand('imandrax.mirDb.retry', (n: TaskNode) => this.changed.fire(n)),
    commands.registerCommand('imandrax.mirDb.clear', () => { this.nodes = []; this.changed.fire(undefined); }),
    commands.registerCommand('imandrax.mirDb.format', () => this.documents.chooseFormat()),
    commands.registerCommand('imandrax.mirDb.switchFormat', (uri?: Uri) => this.documents.switchFormat(uri)),
  ];

  // `session`: fetches the tasks' DBs and reports
  constructor(private readonly session: ApiSession) { }

  // `label` like "decompose fee"; `source`: the file's text, for "This file". The DB is the last task's:
  // ponytail: a file's later POs see a superset of the earlier ones' DBs, so one fetch covers a whole check
  add(label: string, runs: readonly Run[], source: string): string | undefined {
    const tasks = runs.map(r => r.task);
    const task = tasks.at(-1);
    if (!task) { return; }
    const id = task.id.toString();
    const old = this.nodes.find(n => n.ids.has(id)); // content-addressed: the same work again keeps its DB
    const node = old?.label === label && tasks.every(t => old.ids.has(t.id.toString())) ? old : new TaskNode(label, runs, source, this.session);
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

  dispose() { for (const d of this.subscriptions) { d.dispose(); } }
}

// Unique in the tree: the same declaration can show in several groups
const nodeId = (n: Node): string => (n instanceof TaskNode ? n.id
  : `${nodeId(n.parent)}/${n instanceof DeclNode ? n.uid.fullName : n instanceof ReportNode ? `${n.label} ${n.taskId}` : n.label}`);
