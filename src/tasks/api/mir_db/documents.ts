import { Disposable, Hover, languages, MarkdownString, Position, TextDocument, Uri, ViewColumn, window, workspace } from 'vscode';
import { errorText } from '../client';
import { comment } from '../report_printer';
import { DeclNode, ReportNode, TaskNode } from './nodes';

const SCHEME = 'imandrax-mirdb';

// The MIR DB view's read-only documents: a declaration as readable IML, with its rules, termination measure
// and users (hovering a name there shows its full ids, with hashes), or a PO's or decomposition's report
export class MirDbDocuments implements Disposable {
  // Open documents, by URI
  private readonly docs = new Map<string, { node: DeclNode | ReportNode; fullIds?: ReadonlyMap<string, readonly string[]> }>();
  private readonly subscriptions = [
    workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => this.content(uri) }),
    workspace.onDidCloseTextDocument(doc => this.docs.delete(doc.uri.toString())),
    languages.registerHoverProvider({ scheme: SCHEME }, { provideHover: (doc, pos) => this.hover(doc, pos) }),
  ];

  // `listed(task)`: whether the task is still in the view
  constructor(private readonly listed: (task: TaskNode) => boolean) { }

  // A report's label is unique in its task; a declaration's short name may not be
  async open(n: DeclNode | ReportNode) {
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

  dispose() { for (const d of this.subscriptions) { d.dispose(); } }

  private async content(uri: Uri): Promise<string> {
    const entry = this.docs.get(uri.toString());
    if (!entry || !this.listed(entry.node.task)) { return '(* No longer in the ImandraX MIR DB view: open it from there again *)\n'; }
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

  private hover(doc: TextDocument, pos: Position) {
    const range = doc.getWordRangeAtPosition(pos, /[^\s()[\];,]+/);
    const ids = range && this.docs.get(doc.uri.toString())?.fullIds?.get(doc.getText(range));
    return ids && new Hover(new MarkdownString().appendCodeblock(ids.join('\n'), 'text'), range);
  }
}
