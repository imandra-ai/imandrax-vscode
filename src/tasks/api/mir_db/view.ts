import {
  commands, Disposable, EventEmitter, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeView, Uri, window,
} from 'vscode';
import { ApiSession, DecompTask, errorText } from '../client';
import { MirDbDocuments } from './documents';
import { DeclNode, GroupNode, groups, MessageNode, Node, ReportNode, TaskNode } from './nodes';
import { REVEAL_COMMAND } from './reveal';

const VIEW_ID = 'imandrax.mirDb';
const MAX_TASKS = 10;

// The view "ImandraX MIR DB": recent API decompositions (newest first), each with what its MIR DB holds
// beyond the file's own declarations. A task's DB is fetched when its node is first expanded and kept on the
// node until the node leaves the list. A declaration opens as readable IML (or MIR, or raw JSON) in a read-only document
// (MirDbDocuments); the decomposition opens as a report: its regions count, statistics and the prover's steps.
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
    commands.registerCommand('imandrax.mirDb.clear', () => { this.list([]); }),
    commands.registerCommand('imandrax.mirDb.format', () => this.documents.chooseFormat()),
    commands.registerCommand('imandrax.mirDb.switchFormat', (uri?: Uri) => this.documents.switchFormat(uri)),
  ];

  // `session`: fetches the tasks' DBs and reports
  constructor(private readonly session: ApiSession) { }

  // `label` like "decompose fee". Returns the task's id
  add(label: string, source: DecompTask): string {
    const id = source.task.id.toString();
    const old = this.nodes.find(n => n.taskId === id); // content-addressed: the same work again keeps its DB
    const reused = old?.label === label;
    const node = reused ? old : new TaskNode(label, source, this.session);
    if (reused) { source.end(); } else { source.onReplaced = () => { this.changed.fire(node); }; } // the old node keeps its session
    node.time = new Date();
    this.list([node, ...this.nodes.filter(n => n !== node)].slice(0, MAX_TASKS));
    return id;
  }

  async reveal(taskId: string) {
    const node = this.nodes.find(n => n.taskId === taskId);
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
      // Decomposed again (the server no longer had it) as another task
      const now = n.source.task.id.toString();
      item.description = n.time.toLocaleTimeString() + (now === n.taskId ? '' : ' (decomposed again: another task)');
      item.tooltip = now === n.taskId ? n.taskId : `${n.taskId}, decomposed again as ${now}`;
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
      n.children = [n.report, ...groups(n, index)];
      return n.children;
    } catch (e) {
      return [n.report, new MessageNode(n, `Could not load the MIR DB (click to retry): ${errorText(e)}`)];
    }
  }

  dispose() {
    for (const n of this.nodes) { n.source.end(); }
    for (const d of this.subscriptions) { d.dispose(); }
  }

  // The tasks listed: those no longer listed end their sessions
  private list(nodes: TaskNode[]) {
    for (const n of this.nodes) { if (!nodes.includes(n)) { n.source.end(); } }
    this.nodes = nodes;
    this.changed.fire(undefined);
  }
}

// Unique in the tree: the same declaration can show in several groups
const nodeId = (n: Node): string => (n instanceof TaskNode ? n.id
  : `${nodeId(n.parent)}/${n instanceof DeclNode ? n.uid.fullName : n.label}`);
