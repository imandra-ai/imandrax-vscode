import {
  ConfigurationTarget, Disposable, Hover, languages, MarkdownString, Position, TabInputText, TextDocument, Uri, ViewColumn, window, workspace,
} from 'vscode';
import { errorText } from '../client';
import { asFormat, languageOf, MIR_FORMATS, MirFormat, MirRenderer } from '../mir_format';
import { DeclNode, ReportNode, TaskNode } from './nodes';

const SCHEME = 'imandrax-mirdb';
const SETTING = 'experimental.mirDbFormat';
const setting = () => asFormat(workspace.getConfiguration('imandrax').get(SETTING));
const formatOf = (uri: Uri) => asFormat(new URLSearchParams(uri.query).get('format'));

async function pickFormat(current: MirFormat): Promise<MirFormat | undefined> {
  const items = (Object.keys(MIR_FORMATS) as MirFormat[])
    .map(f => ({ label: f, format: f, detail: MIR_FORMATS[f], description: f === current ? '(current)' : undefined }));
  return (await window.showQuickPick(items, { title: 'MIR DB format' }))?.format;
}

// The MIR DB view's read-only documents: a declaration, with its rules, termination measure and users, or a PO's
// or decomposition's report. Their MIR shows in the format in their URI: readable IML (hovering a name there shows
// its full ids, with hashes), the client's textual MIR or its raw structure as JSON
export class MirDbDocuments implements Disposable {
  // Open documents, by URI
  private readonly docs = new Map<string, { node: DeclNode | ReportNode; fullIds?: ReadonlyMap<string, readonly string[]> }>();
  private format = setting(); // the setting's value, as last seen
  private readonly subscriptions = [
    workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => this.content(uri) }),
    workspace.onDidCloseTextDocument(doc => this.docs.delete(doc.uri.toString())),
    workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(`imandrax.${SETTING}`)) { void this.reformat(); } }),
    languages.registerHoverProvider({ scheme: SCHEME }, { provideHover: (doc, pos) => this.hover(doc, pos) }),
  ];

  // `listed(task)`: whether the task is still in the view
  constructor(private readonly listed: (task: TaskNode) => boolean) { }

  // A report's label is unique in its task; a declaration's short name may not be
  async open(n: DeclNode | ReportNode, format = setting(), viewColumn: ViewColumn = ViewColumn.Beside, preview = true) {
    const [name, uid] = n instanceof DeclNode ? [n.uid.shortName, { uid: n.uid.fullName }] : [`${n.label} report`, {}];
    const uri = Uri.from({ scheme: SCHEME, path: `/${name.replace(/\//g, '∕')}.${format}`,
      query: new URLSearchParams({ task: n.task.id, ...uid, format }).toString() });
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
    const language = languageOf(format);
    if (doc.languageId !== language) {
      // Changing the language closes (onDidCloseTextDocument) and reopens the document: keep its entry
      const entry = this.docs.get(key) ?? { node: n };
      doc = await languages.setTextDocumentLanguage(doc, language);
      this.docs.set(key, entry);
    }
    await window.showTextDocument(doc, { viewColumn, preview, preserveFocus: true });
  }

  // "MIR DB format…": the format documents open in (reformat() then switches the open ones)
  async chooseFormat() {
    const f = await pickFormat(setting());
    if (f) { await workspace.getConfiguration('imandrax').update(SETTING, f, ConfigurationTarget.Global); }
  }

  // A document's title action: the same entry in another format, beside it
  async switchFormat(uri = window.activeTextEditor?.document.uri) {
    const entry = uri && this.docs.get(uri.toString());
    const f = entry && await pickFormat(formatOf(uri));
    if (f) { await this.open(entry.node, f); }
  }

  dispose() { for (const d of this.subscriptions) { d.dispose(); } }

  // The setting changed: open documents in its old format show in the new one, in place
  private async reformat() {
    const [old, f] = [this.format, (this.format = setting())];
    if (old === f) { return; }
    for (const tab of window.tabGroups.all.flatMap(g => g.tabs)) {
      const uri = tab.input instanceof TabInputText ? tab.input.uri : undefined;
      const entry = uri && formatOf(uri) === old ? this.docs.get(uri.toString()) : undefined;
      if (!entry) { continue; }
      await this.open(entry.node, f, tab.group.viewColumn, tab.isPreview);
      // A preview tab was replaced by the new one
      if (!tab.isPreview) { await window.tabGroups.close(tab, true); }
    }
  }

  private async content(uri: Uri): Promise<string> {
    const plain = new MirRenderer(formatOf(uri));
    const fail = (s: string) => plain.document([plain.note(s)]);
    const entry = this.docs.get(uri.toString());
    if (!entry || !this.listed(entry.node.task)) { return fail('No longer in the ImandraX MIR DB view: open it from there again'); }
    const { node } = entry;
    if (node instanceof ReportNode) { return node.document(plain.format).catch((e: unknown) => fail(`Could not load the report: ${errorText(e)}`)); }
    try {
      const index = await node.task.load();
      const mir = index.renderer(plain.format);
      const { text, fullIds } = index.document(node.uid, mir, await node.task.termination(node.uid, mir));
      entry.fullIds = fullIds;
      return text;
    } catch (e) {
      return fail(`Could not show ${node.uid.shortName}: ${errorText(e)}`);
    }
  }

  private hover(doc: TextDocument, pos: Position) {
    const range = doc.getWordRangeAtPosition(pos, /[^\s()[\];,]+/);
    const ids = range && this.docs.get(doc.uri.toString())?.fullIds?.get(doc.getText(range));
    return ids && new Hover(new MarkdownString().appendCodeblock(ids.join('\n'), 'text'), range);
  }
}
