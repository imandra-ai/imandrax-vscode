import {
  CodeAction, CodeActionKind, Diagnostic, DiagnosticSeverity, languages, Progress, ProgressLocation, ProgressOptions, Range, TextDocument, Uri, window,
  workspace,
} from 'vscode';
import type { ProofObligationResult } from 'imandrax-api';
import { checkOn } from '../../config';
import { FileProgress, TaskBackend, TaskKind, TaskTarget } from '../backend';
import { connect, errorText, TIMEOUT_MS } from './client';
import { MirDbView, REVEAL_COMMAND } from './mir_db';
import { showRegions } from './regions_view';

// The ImandraX HTTP API runs the tasks; the language server only type-checks and offers the lenses.
// Proof obligation results become diagnostics shaped like the server's (Hint = proved/instance, which
// get the good gutter icon); decompositions show a regions table. Both tasks' MIR DBs can be browsed in
// the view "ImandraX MIR DB": from a diagnostic's code action, the regions table, or the notification.
// ponytail: sends the file's text only, so `[@@@import]`s of local files won't resolve
export class ApiTaskBackend implements TaskBackend {
  private readonly diagnostics = languages.createDiagnosticCollection('ImandraX API');
  // The diagnostics set, by URI: code actions get copies of them (without `taskId`), matched back here
  private readonly shown = new Map<string, readonly PoDiagnostic[]>();
  private readonly mirDb = new MirDbView();
  private readonly browse = languages.registerCodeActionsProvider({ language: 'imandrax' }, {
    provideCodeActions: (doc, _range, context) => {
      const shown = this.shown.get(doc.uri.toString()) ?? [];
      return context.diagnostics.flatMap(d => {
        const po = shown.find(p => p.range.isEqual(d.range) && p.message === d.message && p.source === d.source && p.code === d.code);
        if (!po || !this.mirDb.has(po.taskId)) { return []; }
        const title = `Browse MIR DB (${po.code as string})`;
        const action = new CodeAction(title, CodeActionKind.QuickFix);
        action.command = { title, command: REVEAL_COMMAND, arguments: [po.taskId] };
        action.diagnostics = [d];
        return [action];
      });
    },
  });
  // Running tasks by `${uri} ${kind} ${sym}` (sym '' = the whole file); a new run of the same key cancels the old one
  private readonly runs = new Map<string, AbortController>();
  // Open/save checks waiting for a burst of events to end, by URI
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  // `changed(uri)`: the file's running tasks changed (lenses, status bar)
  constructor(private readonly changed: (uri: Uri) => void) { }

  async check(uri: Uri, target?: TaskTarget) {
    const doc = await open(uri);
    if (doc) { await this.checkPOs(doc, target); }
  }

  // Open/save checks run quietly: errors in the file only show in the status bar, the language server
  // reports them. A burst of saves (Save All, auto save) checks once, 500 ms after the last.
  autoCheck(doc: TextDocument, reason: 'open' | 'save') {
    if (doc.languageId !== 'imandrax' || doc.uri.scheme !== 'file' || !checkOn(reason)) { return; }
    const key = doc.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      void this.checkPOs(doc, undefined, true);
    }, 500));
  }

  async decompose(uri: Uri, target?: TaskTarget) {
    const doc = await open(uri);
    if (!doc) { return; }
    const name = target?.sym ?? await this.askFunction(doc);
    if (!name) { return; }
    const res = await this.run(doc, 'decompose', name,
      { location: ProgressLocation.Notification, title: `Decomposing ${name}`, cancellable: true },
      async (signal, progress) => {
        const client = await connect(signal);
        try {
          progress.report({ message: 'loading file' });
          // Loading the file also runs its `[@@decomp ...]` attributes with their options (~assuming, ~prune, ...);
          // from a lens only that function's tasks run
          const ev = await client.evalSrc(doc.getText(), { taskFilter: target ? [name] : undefined, signal, timeoutMs: TIMEOUT_MS });
          // evalSrc reports success even with errors, and a decompose after that hangs, so stop here
          if (ev.errors.length) { void window.showErrorMessage(`ImandraX: ${ev.errors[0].toString()}`); return; }
          // A function without the attribute (e.g. picked from the palette) gets a plain decomposition
          progress.report({ message: 'decomposing' });
          return ev.decompResults.find(r => r.decomposition?.id.shortName === name)
            ?? await client.decompose(name, { prune: true, stringResults: true, signal, timeoutMs: TIMEOUT_MS });
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    if (!res) { return; }
    if (!res.decomposition) { void window.showErrorMessage(`Decomposition failed: ${res.errors.map(String).join('\n')}`); return; }
    const taskId = res.task && this.mirDb.add(`decompose ${name}`, [{ task: res.task }], doc.getText());
    showRegions(name, res.decomposition.regions, taskId);
    if (taskId) {
      void window.showInformationMessage(`Decomposed ${name}.`, 'Browse MIR DB')
        .then(b => b && this.mirDb.reveal(taskId));
    }
  }

  // The target's task (of its kind, if known), and a whole-file check, as its check lenses show Cancel too
  cancel(uri: Uri, target?: TaskTarget) {
    for (const [key, abort] of this.runs) {
      const [u, kind, sym] = key.split(' ');
      if (u === uri.toString() && (!target || ((!target.kind || kind === target.kind) && (sym === target.sym || sym === '')))) {
        abort.abort();
      }
    }
    return Promise.resolve();
  }

  isRunning(uri: Uri, kind: TaskKind, sym: string) {
    return this.runs.has(runKey(uri, kind, sym)) || (kind === 'check' && this.runs.has(runKey(uri, 'check')));
  }

  // From the results shown: successful = proved/instance found (Hint), failed = refuted or error
  fileProgress(doc: TextDocument): Promise<FileProgress> {
    const ds = this.diagnostics.get(doc.uri) ?? [];
    const successful = ds.filter(d => d.severity === DiagnosticSeverity.Hint).length;
    const failed = ds.filter(d => d.severity === DiagnosticSeverity.Error).length;
    const running = [...this.runs.keys()].some(k => k.startsWith(`${doc.uri.toString()} `));
    return Promise.resolve({ started: ds.length, finished: ds.length, successful, failed, total: ds.length, running });
  }

  dispose() {
    this.pending.forEach(timer => clearTimeout(timer));
    this.runs.forEach(abort => abort.abort());
    this.diagnostics.dispose();
    this.browse.dispose();
    this.mirDb.dispose();
  }

  // Runs `work` with a progress indicator as the file's `kind` task on `sym`; undefined when it failed
  // (after showing why) or was cancelled
  private async run<T>(doc: TextDocument, kind: TaskKind, sym: string | undefined, options: ProgressOptions,
    work: (signal: AbortSignal, progress: Progress<{ message?: string }>) => Promise<T>): Promise<T | undefined> {
    const key = runKey(doc.uri, kind, sym);
    this.runs.get(key)?.abort();
    const abort = new AbortController();
    this.runs.set(key, abort);
    this.changed(doc.uri);
    try {
      const result = await window.withProgress(options, (progress, token) => {
        token.onCancellationRequested(() => abort.abort());
        return work(abort.signal, progress);
      });
      return abort.signal.aborted ? undefined : result;
    } catch (e) {
      if (!abort.signal.aborted) { void window.showErrorMessage(errorText(e)); }
    } finally {
      if (this.runs.get(key) === abort) { this.runs.delete(key); }
      this.changed(doc.uri);
    }
  }

  // The file's POs, or only the target's (the task filter matches full symbols, anonymous
  // `_verify_<line>_<col>` ones included); `quiet`: an open/save check
  private async checkPOs(doc: TextDocument, target?: TaskTarget, quiet = false) {
    const results = await this.run(doc, 'check', target?.sym, { location: ProgressLocation.Window, title: 'ImandraX: checking' },
      async signal => {
        const client = await connect(signal);
        try {
          const ev = await client.evalSrc(doc.getText(),
            { taskFilter: target ? [target.sym] : undefined, signal, timeoutMs: TIMEOUT_MS });
          // evalSrc reports success even with errors
          if (ev.errors.length) {
            if (quiet) {
              window.setStatusBarMessage('ImandraX: not checked, the file has errors', 5000);
            } else {
              void window.showErrorMessage(`ImandraX: ${ev.errors[0].toString()}`);
            }
            return;
          }
          return ev.poResults;
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    if (!results) { return; }
    this.showResults(doc, results, target);
    this.mirDb.add(`check ${target?.sym ?? doc.uri.path.split('/').pop()}`, results, doc.getText());
  }

  // Replaces the file's diagnostics, or with a target only those of the POs that ran
  private showResults(doc: TextDocument, results: readonly ProofObligationResult[], target?: TaskTarget) {
    const ran = new Set(results.map(r => r.origin.fromSym));
    const kept = target ? (this.shown.get(doc.uri.toString()) ?? []).filter(d => !ran.has(d.code as string)) : [];
    const all = [...kept, ...results.map(r => {
      const [severity, message] = verdict(r);
      const d = new PoDiagnostic(placeOf(doc, r, target), message, severity, r.task.id.toString());
      d.source = 'ImandraX'; // decorated in the gutter like the server's
      d.code = r.origin.fromSym; // which PO, for the partial replace above
      return d;
    })];
    this.shown.set(doc.uri.toString(), all);
    this.diagnostics.set(doc.uri, all);
  }

  private async askFunction(doc: TextDocument) {
    const editor = window.activeTextEditor;
    const sel = editor?.document === doc ? editor.selection : undefined;
    const word = sel && doc.getWordRangeAtPosition(sel.active);
    const guess = sel && !sel.isEmpty ? doc.getText(sel) : word ? doc.getText(word) : '';
    return window.showInputBox({ prompt: 'Function to decompose', value: guess });
  }
}

// A PO result, with its task for the "Browse MIR DB" code action
class PoDiagnostic extends Diagnostic {
  constructor(range: Range, message: string, severity: DiagnosticSeverity, readonly taskId: string) {
    super(range, message, severity);
  }
}

const runKey = (uri: Uri, kind: TaskKind, sym = '') => `${uri.toString()} ${kind} ${sym}`;

// A lens's file, which may have been renamed or deleted since
const open = (uri: Uri) => Promise.resolve(workspace.openTextDocument(uri)).catch((e: unknown) => {
  void window.showErrorMessage(`ImandraX: ${e instanceof Error ? e.message : String(e)}`);
  return undefined;
});

const otherLabels: Record<string, string> = { unknown: 'Unknown', err: 'Error', verifiedUpto: 'Verified up to bound', testOk: 'Test passed' };

// Like the server: proved and instances are Hints, counterexamples Errors, anything else a Warning
function verdict(r: ProofObligationResult): [DiagnosticSeverity, string] {
  if (r.proved) { return [DiagnosticSeverity.Hint, 'Proved']; }
  // A found model is a counterexample to a `verify`/theorem (reported with an error) or an instance
  if (r.found && (r.model ? r.model.kind === 'counterExample' : r.errors.length > 0)) {
    return [DiagnosticSeverity.Error, `Refuted, counterexample:\n${r.model?.src.trim() ?? '(not sent)'}`];
  }
  if (r.found) { return [DiagnosticSeverity.Hint, `Instance found:\n${r.model?.src.trim() ?? '(not sent)'}`]; }
  const label = otherLabels[r.outcome ?? ''] ?? 'No result';
  const why = r.message ?? r.errors.map(String).join('\n');
  return [DiagnosticSeverity.Warning, why ? `${label}: ${why}` : label];
}

// The PO's error location if it has one (refuted, unknown, ...), else the clicked lens if it is this PO's,
// else the line defining its symbol: anonymous `verify`/`instance` symbols are `_verify_<line>_<col>`
function placeOf(doc: TextDocument, r: ProofObligationResult, target?: TaskTarget): Range {
  const loc = r.errors.flatMap(e => e.message.locations)[0];
  if (loc) { return new Range(loc.start.line - 1, loc.start.column - 1, loc.stop.line - 1, loc.stop.column); }
  const from = r.origin.fromSym;
  if (target?.lens && target.sym === from) { return target.lens.range; }
  const anon = /^_(?:verify|instance)_(\d+)_\d+$/.exec(from);
  // ponytail: first textual definition of the name; a local `let` of the same name earlier would win
  const name = from.split('.').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = doc.getText().search(new RegExp(`\\b(?:let|rec|and|theorem|lemma|axiom|rule)\\s+${name}(?![\\w'])`));
  const line = anon ? +anon[1] - 1 : doc.positionAt(Math.max(at, 0)).line;
  return doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
}
