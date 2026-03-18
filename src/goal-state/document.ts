/* eslint-disable @typescript-eslint/no-unused-vars */

import {
  CancellationToken,
  CustomDocumentBackup,
  Disposable,
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
  CodeLens
} from 'vscode';

import * as IX from "./imandrax_types"
import * as TermFormatter from "./term-formatter";

import sanitizeHtml from 'sanitize-html';

function sanitize(x: string): string { return sanitizeHtml(x); }


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

class GoalStateConverterMetaData {
  only_anchor: string | undefined; // Anchor in case there is only one item/PO displayed
}

class GoalStateConverter {
  private _abort_signal: AbortSignal | undefined;
  private _po: IX.ProofObligation | undefined;
  private _num_columns: number;

  constructor(num_columns: number, abort_signal?: AbortSignal) {
    this._num_columns = num_columns;
    this._abort_signal = abort_signal;
  }

  turnstile(): string {
    return "<div class='code-like'>|---</div>";
  }

  term2html(t: IX.Term): string {
    const fmttd : string = TermFormatter.prettify(this._num_columns, t, this._po);
    let r = "";
    // r = `${this._num_columns} `;
    // r = r + '-'.repeat(this._num_columns - r.length) + `<br/>`
    r += fmttd
      .replaceAll("\t", "<span class='indent'></span>")
      .replaceAll("\n", "<br/>") +
      "<br/>";
    return `<div class='code-like'>${r}</div>`;
  }

  namedTerm2html(h: IX.NamedTerm): string {
    const thtml = this.term2html(h.term);
    if (h.name)
      return `${h.name}: ${thtml}`;
    else
      return thtml;
  }

  subgoal2html(sg: IX.Sequent | string): string {
    this._abort_signal?.throwIfAborted();

    if (typeof sg === "string")
      return sg;
    else {
      const hyps = sg.hypotheses.map(x => this.namedTerm2html(x));
      const concls = sg.conclusions.map(x => this.namedTerm2html(x));
      return hyps.join("") + this.turnstile() + concls.join("");
    }
  }

  subgoals2html(sgs: (IX.Sequent | string)[]): string {
    this._abort_signal?.throwIfAborted();

    if (sgs.length == 0)
      return "";
    else if (sgs.length == 1)
      return this.subgoal2html(sgs[0]);
    else {
      const sgsp = sgs.map(x => this.subgoal2html(x));
      const sgs_html = sgsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${sgs_html}</ul>`;
    }
  }

  subresult2html(sr: IX.Subresult): string {
    this._abort_signal?.throwIfAborted();

    let r = "<span><table>";
    if (sr.goal)
      r += `<tr><td valign=top>Goal:</td><td>${this.subgoal2html(sr.goal)}</td></tr>`;
    if (sr.subgoals)
      r += `<tr><td valign=top>Subgoals:</td><td>${this.subgoals2html(sr.subgoals)}</td></tr>`;
    if (sr.error)
      r += `<tr><td valign=top>Error:</td><td>${sr.error}</td></tr>`;
    // if (sr.subanchor)
    //   r += `<tr><td valign=top>Sub-anchor:</td><td><div>${sr.subanchor.name}/${sr.subanchor.anchor}</div></td></tr>`;
    // r += `<div>${JSON.stringify(sr)}</div>`;
    r += "</table></span>"
    return r;
  }

  subresults2html(srs: IX.Subresult[]): string {
    this._abort_signal?.throwIfAborted();

    if (srs.length == 0)
      return "";
    else if (srs.length == 1)
      return this.subresult2html(srs[0]);
    else {
      const srsp = srs.map(x => this.subresult2html(x));
      const srs_html = srsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${srs_html}</ul>`;
    }
  }

  subresultss2html(srs: IX.Subresult[][]): string {
    this._abort_signal?.throwIfAborted();

    if (srs.length == 0)
      return "";
    else if (srs.length == 1)
      return this.subresults2html(srs[0]);
    else {
      const srsp = srs.map(x => this.subresults2html(x));
      const srs_html = srsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${srs_html}</ul>`;
    }
  }

  report2html(rep: IX.Report): string {
    this._abort_signal?.throwIfAborted();

    return rep.events.map((event: IX.ReportEvent) => {
      let res = `<div>${event.description}</div>`;
      if (event.sub_report && event.sub_report.events.length > 0) {
        res += this.report2html(event.sub_report);
      }
      return res;
    }).join("");
  }

  errors2html(errors: IX.Error[]): string {
    this._abort_signal?.throwIfAborted();

    return errors.map(x => {
      this._abort_signal?.throwIfAborted();

      let msg = `${x.message.replaceAll('\n', '<br/>')}`;
      if (x.kind != "TacticEvalErr")
        msg = `${x.kind}: ${msg}`
      return `<div class='code-like'>${msg}</div>`
    }).join("\n");
  }

  proof_obligation2html(po: IX.ProofObligation): string {
    this._abort_signal?.throwIfAborted();

    const qed = "&#x25A0";
    let title = "<span class='code-like-title'>";
    this._po = po;
    if (po.location) {
      const loc_uri = Uri.parse(po.location.uri);
      const opts = { viewColumn: ViewColumn.One, preserveFocus: false } as TextDocumentShowOptions;
      const cmd_args = {
        uri: loc_uri, options: opts,
        location: {
          from: { line: Number(po.location.from.line), column: Number(po.location.from.column) },
          to: { line: Number(po.location.to.line), column: Number(po.location.to.column) }
        }
      };
      title = `<a href='#/' class='jump-to' arguments='${JSON.stringify(cmd_args)}'>${po.name}</a>`;
    } else
      title = `${po.name}`;
    title += "</span>";
    title = `<span>${title}<span class='focus-lock-icon' anchor="${sanitize(po.anchor)}"><i class="codicon codicon-unlock"></i></span></span><br/>`;
    if ((po.subgoals?.length > 0) || (po.subresults?.length > 0) || (po.errors?.length > 0)) {
      let r = title;
      if (po.subgoals?.length > 1)
        r += "<h3>Subgoals:</h3>"
      const sgs_html = this.subgoals2html(po.subgoals);
      r += `${sgs_html}`;
      if (po.errors?.length > 0) {
        r += `<details><summary>Problems (${po.errors.length})</summary><ul>${this.errors2html(po.errors)}</ul></details>`;
      }
      if (po.subresults?.length > 0) {
        const srs_html = this.subresultss2html(po.subresults);
        r += `<details><summary>Subresults</summary><ul>${srs_html}</ul></details>`;
      }
      if (po.report && po.report.events?.length > 0) {
        r += `<details><summary>Report</summary><ul>${this.report2html(po.report)}</ul></details>`;
      }
      return r;
    }
    else
      return title + `<div class='code-like'>${qed}</div>`;
  }

  isProven(po: IX.ProofObligation): boolean {
    return po.subgoals?.length == 0 && po.errors?.length == 0;
  }

  isUnattempted(po: IX.ProofObligation): boolean {
    return po.report === undefined;
  }

  to_html(data: IX.GoalState): [string, GoalStateConverterMetaData] {
    const config = workspace.getConfiguration("imandrax");
    const metadata: GoalStateConverterMetaData = new GoalStateConverterMetaData();
    let r = "";
    let pos = data.proof_obligations
    if (config.showProvenGoals == false)
      pos = pos.filter(po => !this.isProven(po));
    if (config.showUnattemptedGoals == false)
      pos = pos.filter(po => !this.isUnattempted(po));
    metadata.only_anchor = pos.length == 1 ? pos[0].anchor : undefined;
    if (pos.length > 0) {
      r += "<h2>Proof obligations</h2>\n";
      const gs = pos.map(x => this.proof_obligation2html(x));
      r += "<p><ul>\n" +
        gs.map(x => { return `<li>${x}</li>`; }).join("\n")
        + "</ul></p>\n";
    }
    else {
      // r += "<div class='code-like'>NORMAL</div>";
      // r += hbox("<div class='code-like'>ABCDEFGHIJKLM</div><div class='code-like'>NOPQRSTUVWXYZ</div>");
      r += "<ul><li><h2>Nothing as of yet.</h2></li><ul>";
    }
    return [r, metadata];
  }
}

export class GoalStateDocument extends Disposable implements CustomDocument {
  private readonly _uri: Uri;
  private _documentData = "";
  private _documentMetaData: GoalStateConverterMetaData | undefined = undefined;
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
    super(() => { return; });
    const txtdec = new TextDecoder();
    this._uri = uri;
    if (data) {
      const gsc = new GoalStateConverter(this._num_columns);
      const [d, md] = gsc.to_html(JSON.parse(txtdec.decode(data)) as IX.GoalState);
      this._documentData = d;
      this._documentMetaData = md;
    }
    this._delegate = delegate;
    this._file_watcher = workspace.createFileSystemWatcher(new RelativePattern(uri, '*'));

    this._file_watcher.onDidChange(async uri => {
      if (this._abort_controller && !this._abort_controller.signal.aborted)
        this._abort_controller.abort();

      const content_bytes = await GoalStateDocument.readFile(uri);
      const content_string = txtdec.decode(content_bytes);
      if (content_string !== "") {
        this._goalStateData = JSON.parse(content_string) as IX.GoalState; // Todo: Proper type check with ts-json-object or similar?
      } else {
        this._goalStateData = undefined;
      }
      this.run_update(this._goalStateData);
    });
  }

  run_update(gsd: IX.GoalState | undefined) {
    // TODO: Remember unfolded <detail> elements somehow

    try {
      if (!gsd) {
        this._documentData = "<div class='code-like'>&#x25A0</div>";
      } else {
        this._abort_controller = new AbortController();
        const gsc = new GoalStateConverter(this._num_columns, this._abort_controller.signal);
        const [d, md] = gsc.to_html(gsd);
        this._documentData = d;
        this._documentMetaData = md;
        this._abort_controller = undefined;

        if (this._focusLockAnchor && !this._goalStateData?.proof_obligations.find(x => x.anchor == this._focusLockAnchor))
          this._focusLockAnchor = undefined;

        this._onDidChangeDocument.fire({ content: this._documentData });
      }
    }
    catch (e) {
      if (e !== null && typeof e === 'object' && "name" in e && e.name == "AbortError")
        this._abort_controller = undefined;
      else
        console.log(`Caught exception while updating goal state view: ${exc2string(e)}`);
    }
  }

  static async create(
    uri: Uri,
    backupId: string | undefined,
    delegate: GoalStateDocumentDelegate,
  ): Promise<GoalStateDocument | PromiseLike<GoalStateDocument>> {
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

  private readonly _onDidDispose = new EventEmitter<void>(); // register disposable?
  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = new EventEmitter<{
    readonly content?: string;
  }>(); // register disposable?
  public readonly onDidChangeDocument = this._onDidChangeDocument.event;

  private readonly _onDidChange = new EventEmitter<{
    readonly label: string,
    undo(): void,
    redo(): void,
  }>(); // register disposable?
  public readonly onDidChange = this._onDidChange.event;

  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  async save(cancellation: CancellationToken): Promise<void> {
    await this.saveAs(this._uri, cancellation);
    // this._savedEdits = Array.from(this._edits);
  }

  async saveAs(targetResource: Uri, _cancellation: CancellationToken): Promise<void> {
    // const fileData = await this._delegate.getFileData();
    // if (cancellation.isCancellationRequested) {
    // 	return;
    // }
    const fileData = new Uint8Array();
    await workspace.fs.writeFile(targetResource, fileData);
  }

  async revert(_cancellation: CancellationToken): Promise<void> {
    const diskContent = await GoalStateDocument.readFile(this.uri);
    // this._documentData = diskContent;
    // this._edits = this._savedEdits;
    // this._onDidChangeDocument.fire({
    // 	content: diskContent,
    // 	edits: this._edits,
    // });
  }

  async backup(destination: Uri, cancellation: CancellationToken): Promise<CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await workspace.fs.delete(destination);
        } catch {
          // Nothing
        }
      }
    };
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
        const insert_pos = by_rng.end.translate(0, 1);

        await workspace.openTextDocument(uri).then(doc => {
          if (doc.isDirty) {
            window.showErrorMessage("Cannot add to @@by attribute because the document has unsaved changes.");
          } else
            window.showTextDocument(doc, ViewColumn.One, false).then(editor => {
              editor.edit(edit => {
                edit.insert(insert_pos, po.byLocation ? ` @> ${new_tactic}` : ` [@@by ${new_tactic}]`);
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
            && (x.command.command == "check" || x.command?.command == "recheck")
            && x.range.contains(po_rng));

          await Promise.all(lenses.map(lens => {
            console.log(`Executing ${JSON.stringify(lens.command)}`);
            return lens.command ? commands.executeCommand(lens.command.command, ...(lens.command.arguments ?? [])) : Promise.resolve();
          }));
        }
      }
    }
    else
      console.log(`Anchor ${anchor} not found`);
  }

  async expand(id: string, anchor: string) : Promise<void> {
    await this.add_to_by(anchor, `expand "${IX.short_id(id)}"`);
  }

  focusLockOnto(anchor: string | undefined) : void {
    this._focusLockAnchor = anchor;
  }

  async simplify() : Promise<void> {
    const anchor = this._focusLockAnchor ?? this._documentMetaData?.only_anchor;
    await this.add_to_by(anchor, `simplify ()`);
  }

  resize(width: number, font_size: number) : void {
    this._num_columns = Math.max(Math.trunc(2.0 * (width * 0.80) / font_size), 10);
    this.run_update(this._goalStateData);
  }
}