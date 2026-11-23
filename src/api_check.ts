// Experimental: check a file's proof obligations over the ImandraX HTTP API (imandrax-api TS client)
// and show their results as diagnostics, instead of the language server's own task submission.

import {
  Command, commands, Diagnostic, DiagnosticCollection, DiagnosticSeverity, ExtensionContext, languages, ProgressLocation, Range,
  TextDocument, Uri, window, workspace,
} from 'vscode';
import type { ProofObligationResult } from 'imandrax-api';
import { connect, errorText } from './api_decomp';
import { checkOn, taskBackend } from './config';

let diagnostics: DiagnosticCollection;
const quietChecks = new Map<string, AbortController>(); // per document, its running open/save check

export function register(context: ExtensionContext) {
  diagnostics = languages.createDiagnosticCollection('ImandraX API');
  // In "api" mode the server is started without checking on open/save; these do it instead, if configured.
  // Only files: the MIR DB browser opens untitled IML documents, diff views use other schemes.
  const checkOnEvent = (event: 'open' | 'save') => (doc: TextDocument) => {
    if (doc.languageId === 'imandrax' && doc.uri.scheme === 'file' && taskBackend() === 'api' && checkOn(event)) {
      void checkQuietly(doc);
    }
  };
  const checkOpen = checkOnEvent('open');
  workspace.textDocuments.forEach(checkOpen); // opened before activation
  context.subscriptions.push(diagnostics, commands.registerCommand('imandrax.experimental.check_via_api', checkViaApi),
    workspace.onDidOpenTextDocument(checkOpen), workspace.onDidSaveTextDocument(checkOnEvent('save')),
    workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('imandrax.experimental.taskBackend')) { return; }
      if (taskBackend() === 'api') { workspace.textDocuments.forEach(checkOpen); } else { diagnostics.clear(); }
    }));
}

// The server's (Re-)check code lens runs `check` with [uri, ['<name>/<hash>']]; point it at
// checkViaApi(uri, name, range) instead. Other lenses are returned untouched.
export function rewriteCheckLens<L extends { command?: Command; range: Range }>(lens: L): L {
  const c = lens.command;
  const [uri, ids] = (c?.arguments ?? []) as unknown[];
  if ((c?.command === 'check' || c?.command === 'recheck') && typeof uri === 'string'
    && Array.isArray(ids) && typeof ids[0] === 'string') {
    lens.command = {
      title: `${c.title} (API)`, command: 'imandrax.experimental.check_via_api', arguments: [uri, ids[0].split('/')[0], lens.range],
    };
  }
  return lens;
}

// From the palette: no args (active editor), checks the whole file. From the Check code lens:
// (uri, PO symbol, lens range), checks only that PO.
async function checkViaApi(uri?: string, sym?: string, lensRange?: Range) {
  const doc = uri ? await workspace.openTextDocument(Uri.parse(uri)) : window.activeTextEditor?.document;
  if (!doc) { void window.showErrorMessage('Open an IML file first.'); return; }
  const results = await window.withProgress(
    { location: ProgressLocation.Notification, title: 'Checking proof obligations via the ImandraX API', cancellable: true },
    (_progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      return evalPOs(doc, abort.signal, sym);
    });
  if (results) { void window.showInformationMessage(showResults(doc, results, sym, lensRange)); }
}

// The whole file, quietly (progress and summary in the status bar). A newer open/save check of the
// document cancels its running one; a burst of saves (Save All, auto save) checks once.
async function checkQuietly(doc: TextDocument) {
  const key = doc.uri.toString();
  quietChecks.get(key)?.abort();
  const abort = new AbortController();
  quietChecks.set(key, abort);
  await new Promise(resolve => setTimeout(resolve, 500));
  const results = abort.signal.aborted ? undefined : await window.withProgress(
    { location: ProgressLocation.Window, title: 'ImandraX API: checking' }, () => evalPOs(doc, abort.signal, undefined, true));
  if (quietChecks.get(key) === abort) { quietChecks.delete(key); }
  if (results && !abort.signal.aborted) { window.setStatusBarMessage(showResults(doc, results), 5000); }
}

// The results of the file's POs, or only of `sym`'s (the task filter matches full symbols, anonymous
// `_verify_<line>_<col>` ones included); undefined after showing the error, or when cancelled
async function evalPOs(doc: TextDocument, signal: AbortSignal, sym?: string, quiet = false) {
  try {
    const client = await connect(signal);
    try {
      // ponytail: sends this file's text only, so `[@@@import]`s of local files won't resolve
      const ev = await client.evalSrc(doc.getText(), { taskFilter: sym === undefined ? undefined : [sym], signal, timeoutMs: 300_000 });
      // evalSrc reports success even with errors. Open/save checks skip quietly: the LSP already shows them
      if (ev.errors.length) {
        const msg = `ImandraX: ${ev.errors[0].toString()}`;
        if (quiet) { window.setStatusBarMessage(`ImandraX API: not checked, the file has errors`, 5000); } else { void window.showErrorMessage(msg); }
        return;
      }
      return ev.poResults;
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (e) {
    if (!signal.aborted) { void window.showErrorMessage(errorText(e)); }
  }
}

// Replaces the file's diagnostics, or with `sym` only those of the POs that ran; returns a summary
function showResults(doc: TextDocument, results: readonly ProofObligationResult[], sym?: string, lensRange?: Range) {
  const ran = new Set(results.map(r => r.origin.fromSym));
  const kept = sym === undefined ? [] : (diagnostics.get(doc.uri) ?? []).filter(d => !ran.has(d.code as string));
  const counts = new Map<string, number>();
  diagnostics.set(doc.uri, [...kept, ...results.map(r => {
    const [label, severity, message] = verdict(r);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    const d = new Diagnostic(placeOf(doc, r, sym, lensRange), message, severity);
    d.source = 'ImandraX API';
    d.code = r.origin.fromSym; // which PO, for the partial replace above
    return d;
  })]);
  return results.length
    ? `ImandraX API: ${[...counts].map(([label, n]) => `${n} ${label.toLowerCase()}`).join(', ')}.`
    : 'ImandraX API: no proof obligations checked.';
}

const otherLabels: Record<string, string> = { unknown: 'Unknown', err: 'Error', verifiedUpto: 'Verified up to bound', testOk: 'Test passed' };

function verdict(r: ProofObligationResult): [string, DiagnosticSeverity, string] {
  if (r.proved) { return ['Proved', DiagnosticSeverity.Information, 'Proved']; }
  // A found model is a counterexample to a `verify`/theorem (reported with an error) or an instance
  if (r.found && (r.model ? r.model.kind === 'counterExample' : r.errors.length > 0)) {
    return ['Refuted', DiagnosticSeverity.Error, `Refuted, counterexample:\n${r.model?.src.trim() ?? '(not sent)'}`];
  }
  if (r.found) { return ['Instance', DiagnosticSeverity.Information, `Instance found:\n${r.model?.src.trim() ?? '(not sent)'}`]; }
  const label = otherLabels[r.outcome ?? ''] ?? 'No result';
  const why = r.message ?? r.errors.map(String).join('\n');
  return [label, DiagnosticSeverity.Warning, why ? `${label}: ${why}` : label];
}

// The PO's error location if it has one (refuted, unknown, ...), else the clicked lens if it is this PO's,
// else the line defining its symbol: anonymous `verify`/`instance` symbols are `_verify_<line>_<col>`
function placeOf(doc: TextDocument, r: ProofObligationResult, sym?: string, lensRange?: Range): Range {
  const loc = r.errors.flatMap(e => e.message.locations)[0];
  if (loc) { return new Range(loc.start.line - 1, loc.start.column - 1, loc.stop.line - 1, loc.stop.column); }
  const from = r.origin.fromSym;
  if (lensRange && sym === from) { return lensRange; }
  const anon = /^_(?:verify|instance)_(\d+)_\d+$/.exec(from);
  // ponytail: first textual definition of the name; a local `let` of the same name earlier would win
  const name = from.split('.').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = doc.getText().search(new RegExp(`\\b(?:let|rec|and|theorem|lemma|axiom|rule)\\s+${name}(?![\\w'])`));
  const line = anon ? +anon[1] - 1 : doc.positionAt(Math.max(at, 0)).line;
  return doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
}
