// Experimental: region decomposition and MIR DB browsing over the ImandraX HTTP API
// (imandrax-api TS client), with no LSP or imandrax-cli involved.

import { commands, ExtensionContext, ProgressLocation, ViewColumn, window, workspace } from 'vscode';
import * as apiKey from './api_key';
import { getExtensionConfig } from './config';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ponytail: drops the content hash from printed uids (`f/3d0Zi...` -> `f`) for readability;
// follow the `toggle_full_ids` setting if full ids are ever needed here
const noHashes = (s: string) => s.replace(/\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '');

const errorText = (e: unknown) => `ImandraX API: ${e instanceof Error ? e.message : String(e)}`;

// Prints the client's JsValue (bigint, Rational, Uid, Constructed, arrays, maps)
function show(v: unknown): string {
  if (Array.isArray(v)) { return `[${v.map(show).join('; ')}]`; }
  if (v instanceof Map) { return `{ ${[...v].map(([k, x]) => `${k} = ${show(x)}`).join('; ')} }`; }
  if (v && typeof v === 'object' && 'name' in v && 'args' in v) {
    const { name, args } = v as { name: string; args: unknown[] };
    return args.length ? `${name} (${args.map(show).join(', ')})` : name;
  }
  return String(v);
}

export function register(context: ExtensionContext) {
  context.subscriptions.push(commands.registerCommand('imandrax.experimental.decompose_via_api', decomposeViaApi));
}

async function decomposeViaApi() {
  const editor = window.activeTextEditor;
  if (!editor) { void window.showErrorMessage('Open an IML file first.'); return; }
  const doc = editor.document;
  const word = doc.getWordRangeAtPosition(editor.selection.active);
  const guess = !editor.selection.isEmpty ? doc.getText(editor.selection) : word ? doc.getText(word) : '';
  const name = await window.showInputBox({ prompt: 'Function to decompose', value: guess });
  if (!name) { return; }
  const key = await apiKey.get();
  if (!key) {
    void window.showErrorMessage('No ImandraX API key: set IMANDRA_API_KEY or write ~/.config/imandrax/api_key.');
    return;
  }
  const connect = async (signal?: AbortSignal) => {
    const { Client } = await import('imandrax-api'); // only loaded when the command runs
    const url = workspace.getConfiguration('imandrax').get<string>('experimental.apiUrl');
    return Client.connect({ url: url === '' ? undefined : url, apiKey: key, signal }); // '' = hosted server
  };

  const task = await window.withProgress(
    { location: ProgressLocation.Notification, title: `Decomposing ${name} via the ImandraX API`, cancellable: true },
    async (progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      const signal = abort.signal;
      try {
        const client = await connect(signal);
        try {
          progress.report({ message: 'loading file' });
          // ponytail: sends this file's text only, so `[@@@import]`s of local files won't resolve
          const ev = await client.evalSrc(doc.getText(), { signal });
          // evalSrc reports success even with errors, and a decompose after that hangs, so stop here
          if (ev.errors.length) { void window.showErrorMessage(`ImandraX: ${ev.errors[0].toString()}`); return; }

          progress.report({ message: 'decomposing' });
          const res = await client.decompose(name, { prune: true, stringResults: true, signal, timeoutMs: 300_000 });
          if (!res.decomposition) {
            void window.showErrorMessage(`Decomposition failed: ${res.errors.map(String).join('\n')}`);
            return;
          }
          showRegions(name, res.decomposition.regions);
          return res.task;
        } finally {
          await client.close().catch(() => undefined);
        }
      } catch (e) {
        if (!signal.aborted) { void window.showErrorMessage(errorText(e)); }
      }
    });

  // The MIR DB (every declaration the task used, prelude included) is only fetched if asked for
  if (!task || await window.showInformationMessage(`Decomposed ${name}.`, 'Browse MIR DB') !== 'Browse MIR DB') { return; }
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
  const picker = window.createQuickPick<typeof items[number]>();
  picker.title = `MIR DB of the decomposition of ${name}: ${items.length} declarations`;
  picker.placeholder = 'Search declarations; Enter opens one to the side';
  picker.items = items;
  picker.matchOnDescription = true;
  picker.ignoreFocusOut = true;
  picker.onDidAccept(async () => {
    const decl = picker.selectedItems[0]?.decl;
    if (!decl) { return; }
    const text = await workspace.openTextDocument({ language: 'imandrax', content: noHashes(decl.toString()) });
    await window.showTextDocument(text, { viewColumn: ViewColumn.Beside, preview: true, preserveFocus: true });
  });
  picker.onDidHide(() => picker.dispose());
  picker.show();
}

function showRegions(name: string, regions: readonly {
  constraintsStr: readonly string[] | undefined; invariantStr: string | undefined;
  sample(): ReadonlyMap<{ shortName: string }, unknown> | undefined; sampleOutput(): unknown;
}[]) {
  const max = getExtensionConfig().largeDecompConfirmation;
  const rows = regions.slice(0, max).map((r, i) => {
    const sample = r.sample();
    const input = sample ? [...sample].map(([uid, v]) => `${uid.shortName} = ${show(v)}`).join(', ') : '';
    const output = r.sampleOutput();
    return `<tr><td>${i + 1}</td><td>${esc(r.constraintsStr?.join(' && ') ?? '')}</td>`
      + `<td>${esc(r.invariantStr ?? '')}</td><td>${esc(input)}</td>`
      + `<td>${esc(output === undefined ? '' : show(output))}</td></tr>`;
  }).join('');
  const note = regions.length > max
    ? `<p>Showing the first ${max} of ${regions.length} regions (setting <code>imandrax.largeDecompConfirmation</code>).</p>`
    : `<p>${regions.length} regions.</p>`;

  const panel = window.createWebviewPanel('imandrax-api-decomp', `Regions of ${name}`, ViewColumn.Beside, {});
  panel.webview.html = `<!DOCTYPE html><html><head><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left;
             vertical-align: top; font-family: var(--vscode-editor-font-family); }
    th { background: var(--vscode-editorWidget-background); }
  </style></head><body>
  <h2>Regions of <code>${esc(name)}</code></h2>${note}
  <table><tr><th>#</th><th>Constraints</th><th>Invariant</th><th>Sample input</th><th>Sample output</th></tr>
  ${rows}</table></body></html>`;
}
