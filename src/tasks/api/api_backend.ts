import { Progress, ProgressLocation, TextDocument, Uri, window, workspace } from 'vscode';
import { TaskBackend, TaskTarget } from '../backend';
import { DecompositionView } from '../decomposition_view';
import { ApiSession, errorText, TIMEOUT_MS } from './client';
import { MirDbView } from './mir_db/view';
import { regionsDecomp } from './regions_printer';

// The ImandraX HTTP API runs decompositions (checks stay on the language server). They show in the Voronoi
// viewer (DecompositionView); their MIR DBs can be browsed in the view "ImandraX MIR DB", from the
// decomposition's panel or the notification.
// ponytail: sends the file's text only, so `[@@@import]`s of local files won't resolve
export class ApiTaskBackend implements TaskBackend {
  private readonly session = new ApiSession();
  private readonly mirDb = new MirDbView(this.session);
  // Running decompositions by `${uri} ${sym}`; a new run of the same key cancels the old one
  private readonly runs = new Map<string, AbortController>();

  // `changed(uri)`: the file's running decompositions changed (lenses)
  constructor(private readonly changed: (uri: Uri) => void, private readonly decompositions: DecompositionView) { }

  async decompose(uri: Uri, target?: TaskTarget) {
    const doc = await open(uri);
    if (!doc) { return; }
    const name = target?.sym ?? await this.askFunction(doc);
    if (!name) { return; }
    const res = await this.decomposition(doc, name, target);
    if (!res) { return; }
    if (!res.decomposition) { void window.showErrorMessage(`Decomposition failed: ${res.errors.map(String).join('\n')}`); return; }
    const taskId = res.task && this.mirDb.add(`decompose ${name}`, res.task, doc.getText());
    void this.decompositions.show([regionsDecomp(name, res.decomposition.regions, taskId)]);
    if (taskId) {
      void window.showInformationMessage(`Decomposed ${name}.`, 'Browse MIR DB')
        .then(b => b && this.mirDb.reveal(taskId));
    }
  }

  // The target's decomposition, or without one all of the file's
  cancel(uri: Uri, target?: TaskTarget) {
    for (const [key, abort] of this.runs) {
      if (target ? key === runKey(uri, target.sym) : key.startsWith(runKey(uri, ''))) { abort.abort(); }
    }
    return Promise.resolve();
  }

  isRunning(uri: Uri, sym: string) { return this.runs.has(runKey(uri, sym)); }

  dispose() {
    this.runs.forEach(abort => abort.abort());
    this.mirDb.dispose();
    this.session.dispose();
  }

  // The decomposition of `name`; undefined if the file has errors, after showing them
  private decomposition(doc: TextDocument, name: string, target?: TaskTarget) {
    return this.run(doc, name, (signal, progress) => this.session.use(signal, async client => {
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

  // Runs `work` with a cancellable progress notification as the file's decomposition of `name`; undefined
  // when it failed (after showing why) or was cancelled
  private async run<T>(doc: TextDocument, name: string,
    work: (signal: AbortSignal, progress: Progress<{ message?: string }>) => Promise<T>): Promise<T | undefined> {
    const key = runKey(doc.uri, name);
    this.runs.get(key)?.abort();
    const abort = new AbortController();
    this.runs.set(key, abort);
    this.changed(doc.uri);
    try {
      const options = { location: ProgressLocation.Notification, title: `Decomposing ${name}`, cancellable: true };
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

const runKey = (uri: Uri, sym: string) => `${uri.toString()} ${sym}`;

// A lens's file, which may have been renamed or deleted since
const open = (uri: Uri) => Promise.resolve(workspace.openTextDocument(uri)).catch((e: unknown) => {
  void window.showErrorMessage(`ImandraX: ${e instanceof Error ? e.message : String(e)}`);
  return undefined;
});
