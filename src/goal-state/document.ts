import {
  EventEmitter,
  FileSystemWatcher,
  RelativePattern,
  Uri,
  CustomDocument,
  workspace,
  ViewColumn,
  TextDocumentShowOptions,
  window,
  Position,
  Range,
  Selection,
  commands,
  CodeLens,
  SymbolInformation,
  SymbolKind,
  TextEditorRevealType
} from 'vscode';

import { LanguageClient } from 'vscode-languageclient/node';

import { getConfig } from "../config";
import { getClient } from '../commands/registration';
import { Disposable } from './dispose';
import * as IX from "./imandrax_types"
import * as GSC from "./state-converter";

function exc2string(e: unknown): string {
  if (e instanceof Error) {
    return e.toString();
  }
  else
    return "Caught unknown error";
}

function sourcelocation2range(location: IX.SourceLocation): Range {
  return new Range(new Position(Number(location.from.line) - 1, Number(location.from.column) - 1),
    new Position(Number(location.to.line) - 1, Number(location.to.column) - 1));
}

interface GoalStateDocumentDelegate {
  getFileData(): Promise<Uint8Array>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function is_bool_true(x: any): boolean {
  return (typeof x === 'boolean') && x;
}

export class GoalStateDocument extends Disposable implements CustomDocument {
  private readonly _uri: Uri;
  private _documentData = "";
  private _documentMetaData: GSC.MetaData | undefined = undefined;
  private _goalStateData: IX.GoalState | undefined = undefined;
  private readonly _delegate: GoalStateDocumentDelegate;
  private _file_watcher: FileSystemWatcher;
  private _abort_controller: AbortController | undefined;
  private _focusLockAnchor: string | undefined = undefined;
  private _num_columns = 50;

  private constructor(
    uri: Uri,
    data: Uint8Array,
    delegate: GoalStateDocumentDelegate
  ) {
    super();
    const txtdec = new TextDecoder();
    this._uri = uri;
    if (data) {
      // Note: VS Code could be giving us data from a backup here.
      this._goalStateData = JSON.parse(txtdec.decode(data)) as IX.GoalState;
      this._abort_controller = (new AbortController());
      void this.update_data(this._goalStateData, this._abort_controller.signal);
      this._documentData = "";
      this._documentMetaData = undefined;
    }
    this._delegate = delegate;
    this._file_watcher = workspace.createFileSystemWatcher(new RelativePattern(uri, '*'));

    this._file_watcher.onDidChange(async uri => {
      this._abort_controller?.abort();
      this._abort_controller = new AbortController();

      const content_bytes = await GoalStateDocument.readFile(uri);
      const content_string = txtdec.decode(content_bytes);
      try {
        if (content_string !== "")
          this._goalStateData = JSON.parse(content_string) as IX.GoalState; // Todo: Proper type-check with ts-json-object or similar?
        else
          this._goalStateData = undefined;
      } catch (e) {
        console.log(`Error parsing goal state: ${exc2string(e)}`);
        this._goalStateData = undefined;
      }

      await this.update_data(this._goalStateData, this._abort_controller?.signal);
    });
  }

  private async update_data(gsd: IX.GoalState | undefined, signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted();

      if (!gsd) {
        this._documentData = "<div class='code-like'>&#x25A0</div>";
      } else {
        // TODO: Remember unfolded <detail> elements somehow

        if (!gsd.format_version)
          console.warn(`Missing goal state data format version`);
        else if (gsd.format_version != 1)
          console.warn(`Unexpected goal state data format version: ${gsd.format_version}`);

        const gsc = new GSC.Converter(this._num_columns, signal);
        const config = getConfig();
        const opts = new GSC.Options(is_bool_true(config.showProvenGoals), is_bool_true(config.showUnattemptedGoals));
        const [d, md] = await gsc.to_html(gsd, opts);
        this._documentData = d;
        this._documentMetaData = md;

        if (this._focusLockAnchor && !this._goalStateData?.proof_obligations.find(x => x.anchor == this._focusLockAnchor))
          this._focusLockAnchor = undefined;

        signal.throwIfAborted();

        this._onDidChangeDocument.fire({ content: this._documentData });
      }
    }
    catch (e) {
      if (e instanceof Error && e.name === 'AbortError')
        console.log(`Aborted!`);
      else
        console.log(`Caught exception while updating goal state view: ${exc2string(e)}`);
    }
  }

  static async create(
    uri: Uri,
    backupId: string | undefined,
    delegate: GoalStateDocumentDelegate,
  ): Promise<GoalStateDocument> {
    const dataFile = typeof backupId === 'string' ? Uri.parse(backupId) : uri;
    const fileData = await GoalStateDocument.readFile(dataFile);
    return new GoalStateDocument(uri, fileData, delegate);
  }

  private static async readFile(uri: Uri): Promise<Uint8Array> {
    if (uri.scheme === 'untitled') {
      return new Uint8Array();
    }
    return new Uint8Array(await workspace.fs.readFile(uri));
  }

  public get uri() { return this._uri; }

  public get documentData(): string { return this._documentData; }

  private readonly _onDidDispose = this._register(new EventEmitter<void>());
  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = this._register(new EventEmitter<{ readonly content?: string; }>());
  public readonly onDidChangeDocument = this._onDidChangeDocument.event;

  private readonly _onDidChange = this._register(new EventEmitter<{
    readonly label: string,
    undo(): void,
    redo(): void,
  }>());
  public readonly onDidChange = this._onDidChange.event;

  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  async jump_to(uri: Uri, options: TextDocumentShowOptions,
    location: { from: { line: number, column: number }; to: { line: number, column: number } }) {
    const uri_obj = Uri.from(uri);
    const alf = location.from;
    const alt = location.to;

    const options_cpy = options;
    options_cpy.selection = new Range(alf.line - 1, alf.column - 1, alt.line - 1, alt.column);

    await window.showTextDocument(uri_obj, options_cpy).then(editor => {
      setTimeout(() => {
        editor.selection = new Selection(alf.line - 1, alf.column - 1, alf.line - 1, alf.column - 1);
      }, 300);
    });
  }

  private async add_to_by(anchor: string | undefined, new_tactic: string) {
    const po = this._goalStateData?.proof_obligations.find(x => x.anchor == anchor);
    if (po) {
      const loc: IX.SourceLocation | undefined = po.byLocation ?? po.location;
      if (loc) {
        const uri = Uri.parse(po.byLocation ? po.byLocation.uri : loc.uri);
        const by_rng = sourcelocation2range(loc);
        const position = by_rng.end.translate(0, 1);

        await workspace.openTextDocument(uri).then(doc => {
          if (doc.isDirty) {
            window.showErrorMessage("Cannot add to @@by attribute because the document has unsaved changes.", "Ok");
          } else
            window.showTextDocument(doc, ViewColumn.One, false).then(editor => {
              editor.edit(edit => {
                const txt = po.byLocation ? ` @> ${new_tactic}` : ` [@@by ${new_tactic}]`;
                edit.insert(position, txt);

                const from = position.translate(0, 1);
                const to = position.translate(0, txt.length + 1);
                editor.selection = new Selection(from, to);
                editor.revealRange(new Range(from, to));
                setTimeout(() => {
                  editor.selection = new Selection(from, from);
                }, 300);
              }).then(() => doc.save());
            });
        });

        if (po.location) {
          const codeLenses = await commands.executeCommand<CodeLens[]>(
            'vscode.executeCodeLensProvider',
            Uri.parse(po.location.uri)
          );

          const po_rng = sourcelocation2range(po.location);
          const lenses = codeLenses.filter(x =>
            x.isResolved && x.command
            && (x.command.command == "check" || x.command?.command == "recheck" || x.command?.command == "cancel")
            && x.range.contains(po_rng));

          await Promise.all(lenses.map(lens => {
            if (lens.command) {
              console.log(`Executing ${JSON.stringify(lens.command)}`);
              return commands.executeCommand(lens.command.command, ...(lens.command.arguments ?? []));
            }
            else
              return Promise.resolve();
          }));
        }
      }
    }
    else {
      window.showErrorMessage(`Cannot modify tactic because the target is unknown. Set a focus lock on the proof obligation you're currently focussing on.`, "Ok");
    }
  }

  async expand(id: string, anchor: string): Promise<void> {
    await this.add_to_by(anchor, `expand "${IX.short_id(id)}"`);
  }

  focusLockOnto(anchor: string | undefined): void {
    this._focusLockAnchor = anchor;
  }

  async simplify(): Promise<void> {
    const anchor = this._focusLockAnchor ?? this._documentMetaData?.only_anchor;
    await this.add_to_by(anchor, `simplify ()`);
  }

  async auto(): Promise<void> {
    const anchor = this._focusLockAnchor ?? this._documentMetaData?.only_anchor;
    await this.add_to_by(anchor, `auto`);
  }

  resize(width: number, font_size: number): void {
    this._num_columns = Math.max(Math.trunc(2.0 * (width * 0.80) / font_size), 10);

    this._abort_controller?.abort();
    this._abort_controller = new AbortController();
    void this.update_data(this._goalStateData, this._abort_controller.signal);
  }

  async jump_to_declaration(symbol: string): Promise<void> {
    if (getClient) {
      const client: LanguageClient = getClient();
      const symbols: SymbolInformation[] = await client.sendRequest("workspace/symbol", { "query": symbol });

      let sym_to_show;
      if (symbols.length > 0) {
        if (symbols.length > 1) {
          const picks = symbols.map(s => ({
            label: `$(symbol-${SymbolKind[s.kind].toLowerCase()}) ${s.name}`,
            description: s.containerName,
            detail: workspace.asRelativePath(s.location.uri),
            symbol: s
          }));
          const picked = await window.showQuickPick(picks);
          sym_to_show = picked?.symbol;
        }
        else
          sym_to_show = symbols[0]

        if (sym_to_show) {
          const { uri, range } = sym_to_show.location;
          const doc = await workspace.openTextDocument(Uri.parse(uri as unknown as string));
          const editor = await window.showTextDocument(doc, ViewColumn.One);

          editor.selection = new Selection(range.start, range.end);
          editor.revealRange(range, TextEditorRevealType.InCenter);
        }
      }
    }
  }
}