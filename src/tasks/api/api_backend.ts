import { Progress, ProgressLocation, ProgressOptions, TextDocument, Uri, window, workspace } from 'vscode';
import { checkOn } from '../../config';
import { FileProgress, TaskBackend, TaskKind, TaskTarget } from '../backend';
import { DecompositionView } from '../decomposition_view';
import { ApiSession, errorText, TIMEOUT_MS } from './client';
import { MirDbView } from './mir_db/view';
import { PoDiagnostics } from './po_diagnostics';
import { regionsDecomp } from './regions_printer';

// The ImandraX HTTP API runs the tasks; the language server only type-checks and offers the lenses.
// Proof obligation results show as diagnostics (PoDiagnostics), decompositions in the Voronoi viewer
// (DecompositionView). Both tasks' MIR DBs can be browsed in the view "ImandraX MIR DB": from a
// diagnostic's code action, the decomposition's panel, or the notification.
// ponytail: sends the file's text only, so `[@@@import]`s of local files won't resolve
export class ApiTaskBackend implements TaskBackend {
  private readonly session = new ApiSession();
  private readonly mirDb = new MirDbView(this.session);
  private readonly diagnostics = new PoDiagnostics(this.mirDb);
  // Running tasks by `${uri} ${kind} ${sym}` (sym '' = the whole file); a new run of the same key cancels the old one
  private readonly runs = new Map<string, AbortController>();
  // Open/save checks waiting for a burst of events to end, by URI
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  // `changed(uri)`: the file's running tasks changed (lenses, status bar)
  constructor(private readonly changed: (uri: Uri) => void, private readonly decompositions: DecompositionView) { }

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
    const res = await this.decomposition(doc, name, target);
    if (!res) { return; }
    if (!res.decomposition) { void window.showErrorMessage(`Decomposition failed: ${res.errors.map(String).join('\n')}`); return; }
    const taskId = res.task && this.mirDb.add(`decompose ${name}`, [{ task: res.task }], doc.getText());
    void this.decompositions.show([regionsDecomp(name, res.decomposition.regions, taskId)]);
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

  fileProgress(doc: TextDocument): Promise<FileProgress> {
    const { total, successful, failed } = this.diagnostics.counts(doc.uri);
    const running = [...this.runs.keys()].some(k => k.startsWith(`${doc.uri.toString()} `));
    return Promise.resolve({ started: total, finished: total, successful, failed, total, running });
  }

  dispose() {
    this.pending.forEach(timer => clearTimeout(timer));
    this.runs.forEach(abort => abort.abort());
    this.diagnostics.dispose();
    this.mirDb.dispose();
    this.session.dispose();
  }

  // `quiet`: an open/save check
  private async checkPOs(doc: TextDocument, target?: TaskTarget, quiet = false) {
    const results = await this.poResults(doc, target, quiet);
    if (!results) { return; }
    this.diagnostics.show(doc, results, target);
    this.mirDb.add(`check ${target?.sym ?? doc.uri.path.split('/').pop()}`, results, doc.getText());
  }

  // The file's PO results, or only the target's (the task filter matches full symbols, anonymous
  // `_verify_<line>_<col>` ones included); undefined if the file has errors, after showing them
  private poResults(doc: TextDocument, target: TaskTarget | undefined, quiet: boolean) {
    return this.run(doc, 'check', target?.sym, { location: ProgressLocation.Window, title: 'ImandraX: checking' },
      signal => this.session.use(signal, async client => {
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
      }));
  }

  // The decomposition of `name`; undefined if the file has errors, after showing them
  private decomposition(doc: TextDocument, name: string, target?: TaskTarget) {
    return this.run(doc, 'decompose', name,
      { location: ProgressLocation.Notification, title: `Decomposing ${name}`, cancellable: true },
      (signal, progress) => this.session.use(signal, async client => {
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
      }));
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

  private async askFunction(doc: TextDocument) {
    const editor = window.activeTextEditor;
    const sel = editor?.document === doc ? editor.selection : undefined;
    const word = sel && doc.getWordRangeAtPosition(sel.active);
    const guess = sel && !sel.isEmpty ? doc.getText(sel) : word ? doc.getText(word) : '';
    return window.showInputBox({ prompt: 'Function to decompose', value: guess });
  }
}

const runKey = (uri: Uri, kind: TaskKind, sym = '') => `${uri.toString()} ${kind} ${sym}`;

// A lens's file, which may have been renamed or deleted since
const open = (uri: Uri) => Promise.resolve(workspace.openTextDocument(uri)).catch((e: unknown) => {
  void window.showErrorMessage(`ImandraX: ${e instanceof Error ? e.message : String(e)}`);
  return undefined;
});
