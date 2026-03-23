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

// eslint-disable-next-line @typescript-eslint/no-require-imports
import sanitize = require('sanitize-html');

import * as IX from "./imandrax_types"
import * as IXRE from "./imandrax_report_event"
import * as TermFormatter from "./term-formatter";

function capitalize(x: string): string {
  if (x.length == 0)
    return x;
  else
    return x.charAt(0).toUpperCase() + x.slice(1);
}

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
    return "<div class='turnstile'>|---</div>";
  }

  async term2html(t: IX.Term): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const fmttd: string = TermFormatter.prettify(this._num_columns, t, this._po);
    const r = fmttd
      .replaceAll("\t", "<span class='indent'></span>")
      .replaceAll("\n", "<br/>") +
      "<br/>";
    return Promise.resolve(r);
  }

  async namedTerm2html(h: IX.NamedTerm): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const trm = await this.term2html(h.term);
    let r;
    if (h.name)
      r = `<div class='code-like'>${h.name}: ${trm}</div>`;
    else
      r = `<div class='code-like'>${trm}</div>`;
    return Promise.resolve(r);
  }

  async sequent2html(sg: IX.Sequent): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const hyps = await Promise.all(sg.hypotheses.map(async x => await this.namedTerm2html(x)));
    const concls = await Promise.all(sg.conclusions.map(async x => this.namedTerm2html(x)));
    return Promise.resolve(hyps.join("") + this.turnstile() + concls.join(""));
  }

  async subgoal2html(sg: IX.Sequent | string): Promise<string> {
    this._abort_signal?.throwIfAborted();

    if (typeof sg === "string")
      return Promise.resolve(sg);
    else
      return await this.sequent2html(sg);
  }

  async subgoals2html(sgs: (IX.Sequent | string)[]): Promise<string> {
    this._abort_signal?.throwIfAborted();

    let r;
    if (sgs.length == 0)
      r = "";
    else if (sgs.length == 1)
      r = this.subgoal2html(sgs[0]);
    else {
      const sgsp = await Promise.all(sgs.map(async x => await this.subgoal2html(x)));
      const sgs_html = sgsp.map(x => `<li>${x}</li>`).join("");
      r = `<ul>${sgs_html}</ul>`;
    }

    return Promise.resolve(r);
  }

  async subresult2html(sr: IX.Subresult): Promise<string> {
    this._abort_signal?.throwIfAborted();

    let r = "<span><table>";
    if (sr.goal)
      r += `<tr><td valign=top>Goal:</td><td>${await this.subgoal2html(sr.goal)}</td></tr>`;
    if (sr.subgoals)
      r += `<tr><td valign=top>Subgoals:</td><td>${await this.subgoals2html(sr.subgoals)}</td></tr>`;
    if (sr.error)
      r += `<tr><td valign=top>Error:</td><td>${sr.error}</td></tr>`;
    r += "</table></span>"

    return Promise.resolve(r);
  }

  async subresults2html(srs: IX.Subresult[]): Promise<string> {
    this._abort_signal?.throwIfAborted();

    if (srs.length == 0)
      return "";
    else if (srs.length == 1)
      return await this.subresult2html(srs[0]);
    else {
      const srsp = await Promise.all(srs.map(async x => await this.subresult2html(x)));
      const srs_html = srsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${srs_html}</ul>`;
    }
  }

  async subresultss2html(srs: IX.Subresult[][]): Promise<string> {
    this._abort_signal?.throwIfAborted();

    if (srs.length == 0)
      return "";
    else if (srs.length == 1)
      return await this.subresults2html(srs[0]);
    else {
      const srsp = await Promise.all(srs.map(async x => await this.subresults2html(x)));
      const srs_html = srsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${srs_html}</ul>`;
    }
  }

  async report_event2html(e: IXRE.ReportEvent): Promise<string> {
    let r: string;
    const d: IXRE.Description = e.description;
    switch (d.constructor) {
      case "E_message": r = `${d.message}`; break;
      case "E_title": r = `${d.title}`; break;
      case "E_enter_waterfall": r = `Enter waterfall with variables [${d.vars.join(", ")}] and goal <div class='code-like'>${await this.term2html(d.goal)}</div>`; break;
      case "E_enter_tactic": r = `Enter '${d.tactic}'`; break;
      case "E_rw_success": r = `Rewriting success: by '${d.rule}' from ${await this.term2html(d.from)} to ${await this.term2html(d.to)}`; break;
      case "E_rw_fail": r = `Rewriting failure: by '${d.rule}' from ${await this.term2html(d.term)} because '${d.reason}'`; break;
      case "E_inst_success": r = `Instantiation success: by '${d.rule}' obtain ${await this.term2html(d.term)}`; break;
      case "E_waterfall_checkpoint": {
        const cs = await Promise.all(d.checkpoints.map(x => this.sequent2html(x)));
        r = `Waterfall checkpoint(s): ${cs.join("<br/>")}`;
        break;
      }
      case "E_induction_scheme": r = `Induction scheme: ${await this.term2html(d.scheme)}`; break;
      case "E_attack_subgoal": r = `Subgoal ${d.name} (depth ${d.depth}): <div class='code-like'>${await this.sequent2html(d.goal)}</div>`; break;
      case "E_simplify_t": r = `Simplify ${await this.term2html(d.from)} into ${await this.term2html(d.to)}`; break;
      case "E_simplify_clause": {
        const to_ = await Promise.all(d.to.map(x => this.term2html(x)));
        r = `Simplify clause ${await this.term2html(d.from)} into ${to_.join("")}`;
        break;
      }
      case "E_proved_by_smt": r = `Proved by SMT; Proof: ${d.proof}`; break;
      case "E_refuted_by_smt": r = `Refuted by SMT; Model: ${d.model}`; break;
      case "E_fun_expansion": r = `Expand ${await this.term2html(d.from)} into ${await this.term2html(d.to)}`; break;
      default:
        r = JSON.stringify(d);
    }
    return Promise.resolve(r);
  }

  async report2html(rep: IX.Report): Promise<string> {
    this._abort_signal?.throwIfAborted();

    return (await Promise.all(rep.events.map(async (event: IXRE.ReportEvent) => {
      let res = `<div>${await this.report_event2html(event)}</div>`;
      if (event.sub_report && event.sub_report.events.length > 0) {
        res += await this.report2html(event.sub_report);
      }
      return res;
    }))).join("");
  }

  async errors2html(errors: IX.Error[]): Promise<string> {
    this._abort_signal?.throwIfAborted();

    return Promise.resolve((errors.map(x => {
      this._abort_signal?.throwIfAborted();

      let msg = `${x.message.replaceAll('\n', '<br/>')}`;
      if (x.kind != "TacticEvalErr")
        msg = `${x.kind}: ${msg}`
      return `<div class='code-like'>${msg}</div>`
    })).join("\n"));
  }

  async proof_obligation2html(po: IX.ProofObligation, multiple_in_modules: boolean, index_in_file: number): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const qed = "&#x25A0";
    let title = "<span class='code-like-title'>";
    this._po = po;
    if (po.location) {
      let name = po.name
      if (multiple_in_modules) {
        const slash_inx = po.location.uri.lastIndexOf('/');
        if (slash_inx >= 0 && slash_inx < po.location.uri.length) {
          const filename = po.location.uri.substring(slash_inx + 1);
          const dot_inx = filename.lastIndexOf(".");
          const module = capitalize(dot_inx > 0 ? filename.substring(0, dot_inx) : filename);
          name = `${module}.${name}`
        }
      }
      if (index_in_file > 0)
        name = name + ` (#${index_in_file})`;
      const loc_uri = Uri.parse(po.location.uri);
      const opts = { viewColumn: ViewColumn.One, preserveFocus: false } as TextDocumentShowOptions;
      const cmd_args = {
        uri: loc_uri, options: opts,
        location: {
          from: { line: Number(po.location.from.line), column: Number(po.location.from.column) },
          to: { line: Number(po.location.to.line), column: Number(po.location.to.column) }
        }
      };
      title = `<a href='#/' class='jump-to' arguments='${JSON.stringify(cmd_args)}'>${name}</a>`;
      const vars = po.vars.join(" ");
      title = `<div class='hoverable' data-hover='${po.name} ${vars}'>${title}</div>`;
    } else
      title = `${po.name}`;
    title += "</span>";
    title = `<span>${title}<span class='focus-lock-icon' anchor="${sanitize(po.anchor)}"><i class="codicon codicon-unlock"></i></span></span><br/>`;
    let r = title;
    if ((po.subgoals?.length > 0) || (po.subresults?.length > 0) || (po.errors?.length > 0)) {
      if (po.subgoals?.length > 1)
        r += "<h3>Subgoals:</h3>"
      const sgs_html = await this.subgoals2html(po.subgoals);
      r += `${sgs_html}`;
      if (po.errors?.length > 0) {
        r += `<details><summary>Problems (${po.errors.length})</summary><ul>${await this.errors2html(po.errors)}</ul></details>`;
      }
      if (po.subresults?.length > 0) {
        const srs_html = await this.subresultss2html(po.subresults);
        r += `<details><summary>Subresults</summary><ul>${srs_html}</ul></details>`;
      }
      if (po.report && po.report.events?.length > 0) {
        r += `<details><summary>Report</summary><ul>${await this.report2html(po.report)}</ul></details>`;
      }
      return Promise.resolve(r);
    }
    else
      return Promise.resolve(r + `<div class='code-like'>${qed}</div>`);
  }

  isProven(po: IX.ProofObligation): boolean {
    return po.subgoals?.length == 0 && po.errors?.length == 0;
  }

  isUnattempted(po: IX.ProofObligation): boolean {
    return po.report === undefined;
  }

  po_counts(pos: IX.ProofObligation[]): Map<string | undefined, Map<string, number>> {
    const r = new Map<string | undefined, Map<string, number>>();
    pos.forEach(po => {
      const at_uri = r.get(po.location?.uri);
      if (!at_uri) {
        r.set(po.location?.uri, new Map([[po.name, 1]]));
      }
      else {
        const at_name = at_uri.get(po.name);
        if (!at_name)
          r.set(po.location?.uri, at_uri.set(po.name, 1));
        else
          r.set(po.location?.uri, at_uri.set(po.name, at_name + 1));
      }
    }
    );
    return r;
  }

  async to_html(data: IX.GoalState): Promise<[string, GoalStateConverterMetaData]> {
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

      pos = pos.sort((x, y) => {
        if (!x.location) return +1
        else if (!y.location) return -1;
        else if (x.location.uri < y.location.uri) return -1;
        else if (x.location.uri > y.location.uri) return +1;
        else if (x.location.from.line < y.location.from.line) return -1;
        else if (x.location.from.line > y.location.from.line) return +1;
        else if (x.location.from.column < y.location.from.column) return -1;
        else if (x.location.from.column > y.location.from.column) return +1;
        else return 0;
      });

      const counts = this.po_counts(pos);
      const done = new Map<string, number>();

      const gs = pos.map(async po => {
        const at_uri = counts.get(po.location?.uri);
        const num_in_same_module = at_uri?.get(po.name) ?? 0; // Number of times the PO name appears in the current module
        let num_modules_with_name = 0; // Number of modules in which this PO name appears
        for (const [_, value] of counts)
          if (value.get(po.name))
            num_modules_with_name++;

        const longname = po.location?.uri + "." + po.name;
        const inx_in_same_module = done.get(longname) ?? (num_in_same_module == 1 ? 0 : 1); // Index of the PO name in the current module
        done.set(longname, inx_in_same_module + 1);
        return await this.proof_obligation2html(po, num_modules_with_name > 1, inx_in_same_module);
      });
      r += "<p><ul>\n" +
        (await Promise.all(gs.map(async x => { return `<li>${await x}</li>`; }))).join("\n")
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

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () =>
      reject(new Error('Aborted')), { once: true }
    );
    promise.then(resolve, reject);
  });
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
      // Note: VS Code could be giving us data from a backup here.
      this._goalStateData = JSON.parse(txtdec.decode(data)) as IX.GoalState;
      this._abort_controller = (new AbortController());
      void this._update_data(this._goalStateData, this._abort_controller.signal);
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
        this._goalStateData = undefined;
      }

      await this._update_data(this._goalStateData, this._abort_controller?.signal);
    });
  }

  private async _update_data(gsd: IX.GoalState | undefined, signal: AbortSignal): Promise<void> {
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

        const gsc = new GoalStateConverter(this._num_columns, signal);
        const [d, md] = await gsc.to_html(gsd);
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

  async resize(width: number, font_size: number): Promise<void> {
    this._num_columns = Math.max(Math.trunc(2.0 * (width * 0.80) / font_size), 10);

    this._abort_controller?.abort();
    this._abort_controller = new AbortController();
    await this._update_data(this._goalStateData, this._abort_controller.signal);
  }
}