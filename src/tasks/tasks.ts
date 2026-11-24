import { CodeLens, commands, Disposable, TextDocument, TextEditor, Uri, window, workspace } from 'vscode';
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

// Routes tasks by kind: checks always run on the language server, decompositions where the setting
// `imandrax.experimental.taskBackend` says. Code lenses and commands look the same in both modes.
export class Tasks implements Disposable {
  private readonly lsp: LspTaskBackend;
  // Only in api mode
  private api?: ApiTaskBackend;
  private readonly subscriptions: Disposable[];

  constructor(private readonly getClient: () => LanguageClient | undefined, private readonly extensionUri: Uri) {
    this.lsp = new LspTaskBackend(getClient);
    this.setMode();
    const register = (c: TaskCommand) => commands.registerCommand(commandId(c),
      (uri?: string, target?: TaskTarget) => this.run(c, uri, target));
    this.subscriptions = [
      register('check'), register('decompose'), register('cancel'),
      commands.registerCommand('imandrax.check_all', async () => {
        const doc = activeDocument();
        if (doc) { await this.lsp.check(doc.uri); }
      }),
      workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('imandrax.experimental.taskBackend') && (taskBackend() === 'api') !== !!this.api) { this.setMode(); }
      }),
    ];
  }

  // For the language client: the server's check/recheck/decompose/redecompose/cancel lenses keep their
  // titles but run the neutral commands with [uri, target]. While the API runs a lens's decomposition, the
  // lens is Cancel, like the server's.
  readonly middleware: Middleware = {
    provideCodeLenses: async (document, token, next) =>
      (await next(document, token))?.map(lens => this.rewriteLens(document, lens)),
  };

  // The status bar's (the language server's checks)
  fileProgress(doc: TextDocument) { return this.lsp.fileProgress(doc); }

  dispose() {
    this.api?.dispose();
    this.lsp.dispose();
    this.subscriptions.forEach(s => { s.dispose(); });
  }

  // Creates or drops the API backend for the setting
  private setMode() {
    this.api?.dispose();
    const api = taskBackend() === 'api';
    this.api = api ? new ApiTaskBackend(uri => this.changed(uri), new DecompositionView(this.extensionUri)) : undefined;
    void commands.executeCommand('setContext', 'imandrax.apiBackend', api); // shows the MIR DB view
  }

  // Decompositions and cancelling them (an API decomposition's Cancel lens, or no lens at all) go to the
  // API backend if there is one; checks and the server's own Cancel lenses (no kind) to the server
  private backendFor(command: 'decompose' | 'cancel', target?: TaskTarget): TaskBackend {
    const decompose = command === 'decompose' || (command === 'cancel' && (!target || target.kind === 'decompose'));
    return decompose ? this.api ?? this.lsp : this.lsp;
  }

  // From a lens: (uri, target). From the palette or a key binding: the active editor, and the target of
  // the closest such lens at or above the cursor, if any.
  private async run(command: TaskCommand, uri?: string, target?: TaskTarget) {
    let file = uri ? Uri.parse(uri) : undefined;
    if (!file) {
      const editor = window.activeTextEditor;
      if (!editor || !activeDocument()) { return; }
      file = editor.document.uri;
      const lens = await closestLens(editor, l => l.command?.command === commandId(command));
      target = lens?.command?.arguments?.[1] as TaskTarget | undefined;
    }
    await (command === 'check' ? this.lsp.check(file, target) : this.backendFor(command, target)[command](file, target));
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
    lens.command = command === 'decompose' && this.api?.isRunning(doc.uri, target.sym)
      ? { title: '⧗ Cancel', command: commandId('cancel'), arguments: [uri, target] }
      : { ...c, command: commandId(command), arguments: [uri, target] }; // the server's title and tooltip
    return lens;
  }

  // The file's running API decompositions changed: re-request its lenses (Cancel)
  private changed(uri: Uri) {
    const doc = workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const client = this.getClient();
    if (doc && client?.isRunning()) {
      client.getFeature('textDocument/codeLens').getProvider(doc)?.onDidChangeCodeLensEmitter.fire();
    }
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
