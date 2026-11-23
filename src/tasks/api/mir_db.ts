import {
  Disposable, Hover, languages, MarkdownString, ProgressLocation, QuickPickItemKind, TextDocument, ViewColumn, window, workspace,
} from 'vscode';
import type { DecompositionResult } from 'imandrax-api';
import { connect, errorText } from './client';
import { printDeclaration } from './mir_printer';

type DecompTask = NonNullable<DecompositionResult['task']>;

// Browses the MIR DB of a decomposition task (every declaration it used, prelude included): a quick
// pick opens a declaration as readable IML; hovering a name there shows its full ids (with hashes).
export class MirDbBrowser implements Disposable {
  private readonly fullIdsByDoc = new WeakMap<TextDocument, ReadonlyMap<string, readonly string[]>>();
  private readonly hover = languages.registerHoverProvider({ scheme: 'untitled', language: 'imandrax' }, {
    provideHover: (doc, pos) => {
      const range = doc.getWordRangeAtPosition(pos, /[^\s()[\];,]+/);
      const ids = range && this.fullIdsByDoc.get(doc)?.get(doc.getText(range));
      return ids && new Hover(new MarkdownString().appendCodeblock(ids.join('\n'), 'text'), range);
    },
  });

  // Asks first: the DB is only fetched if wanted
  async offer(name: string, doc: TextDocument, task: DecompTask) {
    if (await window.showInformationMessage(`Decomposed ${name}.`, 'Browse MIR DB') !== 'Browse MIR DB') { return; }
    const db = await Promise.resolve(window.withProgress({ location: ProgressLocation.Notification, title: 'Loading MIR DB' }, async () => {
      const client = await connect(); // the decomposition's session is closed; artifacts outlive it
      try {
        task.setClient(client);
        return await task.db();
      } finally {
        await client.close().catch(() => undefined);
      }
    })).catch((e: unknown) => { void window.showErrorMessage(errorText(e)); });
    if (!db) { return; }

    const items = [...db.decls.values()]
      .map(decl => ({ label: decl.id.shortName, description: decl.kind, decl }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // ponytail: MIR decls carry no source location, so "this file" = names the file's text defines;
    // a top-level parse (imlformat's iml2json) would be exact if local `let`s ever mislead this
    const defined = new Set([...doc.getText().matchAll(
      /\b(?:let(?:\s+rec)?|and|type|theorem|lemma|axiom|rule|instance|verify)\s+([A-Za-z_][\w']*)/g)].map(m => m[1]));
    const separator = (label: string) => ({ label, kind: QuickPickItemKind.Separator, decl: undefined });
    const picker = window.createQuickPick<{ label: string; decl: typeof items[number]['decl'] | undefined }>();
    picker.title = `MIR DB of the decomposition of ${name}: ${items.length} declarations`;
    picker.placeholder = 'Search declarations; Enter opens one to the side';
    picker.items = [
      separator('This file'), ...items.filter(i => defined.has(i.label)),
      separator('Prelude and others'), ...items.filter(i => !defined.has(i.label)),
    ];
    picker.matchOnDescription = true;
    picker.ignoreFocusOut = true;
    picker.onDidAccept(async () => {
      const decl = picker.selectedItems[0]?.decl;
      if (!decl) { return; }
      const { text: content, fullIds } = printDeclaration(decl, db);
      const text = await workspace.openTextDocument({ language: 'imandrax', content });
      this.fullIdsByDoc.set(text, fullIds);
      await window.showTextDocument(text, { viewColumn: ViewColumn.Beside, preview: true, preserveFocus: true });
    });
    picker.onDidHide(() => picker.dispose());
    picker.show();
  }

  dispose() { this.hover.dispose(); }
}
