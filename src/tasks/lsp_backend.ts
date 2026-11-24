import { TextDocument, Uri, window } from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { FileProgress, TaskBackend, TaskTarget } from './backend';

interface FileProgressResponse {
  task_stats: { finished: string; successful: string; failed: string; started: string; total: string } | null;
}

// The language server runs the tasks: lens commands are replayed to it as they came, the whole file
// is its `check-all`, and it checks on open/save itself (`--check-on-open` / `--check-on-save`).
// Like the server's own lenses, nothing happens while the server is down.
export class LspTaskBackend implements TaskBackend {
  constructor(private readonly getClient: () => LanguageClient | undefined) { }

  async check(uri: Uri, target?: TaskTarget) {
    if (target?.lens) { return this.replay(target.lens); }
    if (uri.scheme === 'file') { await this.execute('check-all', [uri.toString()]); } // not e.g. MIR DB documents
  }

  async decompose(_uri: Uri, target?: TaskTarget) {
    if (target?.lens) { return this.replay(target.lens); }
    void window.showInformationMessage('ImandraX: put the cursor below a Decompose code lens.');
  }

  // Only the server's own Cancel lenses: a Cancel lens left from the API backend carries its check/decompose
  async cancel(_uri: Uri, target?: TaskTarget) {
    if (target?.lens?.command === 'cancel') { return this.replay(target.lens); }
    void window.showInformationMessage('ImandraX: no running task at the cursor.');
  }

  autoCheck() { /* the server does it */ }

  isRunning() { return false; }

  async fileProgress(doc: TextDocument): Promise<FileProgress | null | undefined> {
    const client = this.getClient();
    if (!client) { return null; } // no server (or restarting): nothing to show
    if (!client.isRunning() || doc.uri.scheme !== 'file') { return undefined; }
    const rsp = await client.sendRequest<FileProgressResponse>('$imandrax/req-file-progress', { uri: doc.uri.path })
      .catch(() => undefined); // fine, we'll get it the next time
    if (!rsp) { return undefined; }
    const s = rsp.task_stats;
    if (!s) { return null; } // null or missing: hide
    return {
      started: +s.started, finished: +s.finished, successful: +s.successful, failed: +s.failed, total: +s.total,
    };
  }

  dispose() { /* nothing to release */ }

  private replay(lens: NonNullable<TaskTarget['lens']>) {
    return this.execute(lens.command, lens.arguments);
  }

  private async execute(command: string, args: readonly unknown[]) {
    const client = this.getClient();
    if (!client?.isRunning()) { return; }
    await client.sendRequest('workspace/executeCommand', { command, arguments: [...args] })
      .catch((e: unknown) => { void window.showErrorMessage(`ImandraX: ${e instanceof Error ? e.message : String(e)}`); });
  }
}
