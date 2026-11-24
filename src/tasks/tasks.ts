import { CodeLens, commands, Disposable, EventEmitter, TextDocument, TextEditor, Uri, window, workspace } from 'vscode';
import type { LanguageClient, Middleware } from 'vscode-languageclient/node';
import { taskBackend } from '../config';
import { ApiTaskBackend } from './api/api_backend';
import { TaskBackend, TaskKind, TaskTarget } from './backend';
import { DecompositionView } from './decomposition_view';
import { LspTaskBackend } from './lsp_backend';

type TaskCommand = TaskKind | 'cancel';

// The server's task lens commands, and the neutral commands they are rewritten to
const NEUTRAL: Record<string, TaskCommand> = {
  check: 'check', recheck: 'check', decompose: 'decompose', redecompose: 'decompose', cancel: 'cancel',
};
const commandId = (c: TaskCommand) => `imandrax.task.${c}`;
const TASK_COMMANDS = new Set((['check', 'decompose', 'cancel'] as const).map(commandId));

// A (rewritten) check/decompose/cancel code lens
export const isTaskLens = (lens: CodeLens) => !!lens.command && TASK_COMMANDS.has(lens.command.command);

// Owns where tasks run (setting `imandrax.experimental.taskBackend`). Code lenses, commands and
// open/save events look the same in both modes and go to the active backend.
export class Tasks implements Disposable {
  private mode = taskBackend();
  private backend: TaskBackend;
  private readonly progressChanged = new EventEmitter<Uri>();
  // A file's running tasks or results changed (the status bar listens)
  readonly onDidChangeProgress = this.progressChanged.event;
  private readonly subscriptions: Disposable[];

  constructor(private readonly getClient: () => LanguageClient | undefined, private readonly extensionUri: Uri) {
    this.backend = this.createBackend();
    const register = (c: TaskCommand) => commands.registerCommand(commandId(c),
      (uri?: string, target?: TaskTarget) => this.run(c, uri, target));
    this.subscriptions = [
      register('check'), register('decompose'), register('cancel'),
      commands.registerCommand('imandrax.check_all', async () => {
        const doc = activeDocument();
        if (doc) { await this.backend.check(doc.uri); }
      }),
      workspace.onDidOpenTextDocument(doc => this.backend.autoCheck(doc, 'open')),
      workspace.onDidSaveTextDocument(doc => this.backend.autoCheck(doc, 'save')),
      // The language client restarts the server itself, with arguments for the new mode (configuration.get)
      workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('imandrax.experimental.taskBackend') && taskBackend() !== this.mode) { this.swapBackend(); }
      }),
      this.progressChanged,
    ];
    workspace.textDocuments.forEach(doc => this.backend.autoCheck(doc, 'open')); // opened before activation
  }

  // For the language client: the server's check/recheck/decompose/redecompose/cancel lenses keep their
  // titles but run the neutral commands with [uri, target]. While the extension itself runs a lens's task,
  // the lens is Cancel, like the server's.
  readonly middleware: Middleware = {
    provideCodeLenses: async (document, token, next) =>
      (await next(document, token))?.map(lens => this.rewriteLens(document, lens)),
  };

  fileProgress(doc: TextDocument) { return this.backend.fileProgress(doc); }

  dispose() {
    this.backend.dispose();
    this.subscriptions.forEach(s => { s.dispose(); });
  }

  private createBackend(): TaskBackend {
    void commands.executeCommand('setContext', 'imandrax.apiBackend', this.mode === 'api'); // shows the MIR DB view
    return this.mode === 'api' ? new ApiTaskBackend(uri => this.changed(uri), new DecompositionView(this.extensionUri)) : new LspTaskBackend(this.getClient);
  }

  private swapBackend() {
    this.backend.dispose();
    this.mode = taskBackend();
    this.backend = this.createBackend();
    workspace.textDocuments.forEach(doc => this.backend.autoCheck(doc, 'open'));
    const active = window.activeTextEditor?.document.uri;
    if (active) { this.progressChanged.fire(active); }
  }

  // From a lens: (uri, target). From the palette or a key binding: the active editor, and the target of
  // the closest such lens at or above the cursor, if any.
  private async run(command: TaskCommand, uri?: string, target?: TaskTarget) {
    if (uri) { return this.backend[command](Uri.parse(uri), target); }
    const editor = window.activeTextEditor;
    if (!editor || !activeDocument()) { return; }
    const lens = await closestLens(editor, l => l.command?.command === commandId(command));
    await this.backend[command](editor.document.uri, lens?.command?.arguments?.[1] as TaskTarget | undefined);
  }

  private rewriteLens(doc: TextDocument, lens: CodeLens): CodeLens {
    const c = lens.command;
    const command = c && NEUTRAL[c.command];
    const [uri, ids] = (c?.arguments ?? []) as unknown[];
    if (!command || typeof uri !== 'string' || !Array.isArray(ids) || typeof ids[0] !== 'string') { return lens; }
    const target: TaskTarget = {
      sym: ids[0].split('/')[0], ...(command === 'cancel' ? {} : { kind: command }),
      lens: { command: c.command, arguments: c.arguments!, range: lens.range },
    };
    lens.command = command !== 'cancel' && this.backend.isRunning(doc.uri, command, target.sym)
      ? { title: '⧗ Cancel', command: commandId('cancel'), arguments: [uri, target] }
      : { ...c, command: commandId(command), arguments: [uri, target] }; // the server's title and tooltip
    return lens;
  }

  // The file's running tasks changed: re-request its lenses (Cancel) and update the status bar
  private changed(uri: Uri) {
    const doc = workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const client = this.getClient();
    if (doc && client?.isRunning()) {
      client.getFeature('textDocument/codeLens').getProvider(doc)?.onDidChangeCodeLensEmitter.fire();
    }
    this.progressChanged.fire(uri);
  }
}

function activeDocument() {
  const doc = window.activeTextEditor?.document;
  if (doc?.languageId === 'imandrax') { return doc; }
  void window.showErrorMessage('ImandraX: open an IML file first.');
}

// The resolved code lens closest above the cursor (on its line included) that `pick` accepts
export async function closestLens(editor: TextEditor, pick: (lens: CodeLens) => boolean = () => true) {
  const line = editor.selection.active.line;
  const lenses = await commands.executeCommand<CodeLens[] | undefined>('vscode.executeCodeLensProvider', editor.document.uri) ?? [];
  return lenses.reduce<CodeLens | undefined>((closest, l) =>
    l.isResolved && l.command && pick(l) && l.range.start.line <= line && (!closest || l.range.start.line > closest.range.start.line)
      ? l : closest, undefined);
}
