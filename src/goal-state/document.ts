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

function sourcelocation2range(location: IX.SourceLocation): Range {
  return new Range(new Position(Number(location.from.line) - 1, Number(location.from.column) - 1),
    new Position(Number(location.to.line) - 1, Number(location.to.column) - 1));
}

function short_id(id: string): string {
  const slash_inx = id.lastIndexOf("/");
  if (slash_inx < 0)
    return id;
  else
    return id.slice(0, slash_inx);
}

function span(e: string, hover?: string): string {
  if (hover !== undefined)
    return `<span class='hoverable' data-hover='${hover.replaceAll("'", "&#39;")}'>${e}</span>`;
  else
    return `<span>${e}</span>`;
}

function cmdspan(e: string, cmd: string, args: object) {
  return `<span class='${cmd}' arguments='${JSON.stringify(args).replaceAll("'", "&#39;")}'>${e}</span>`;
}

function hkw(w: string): string {
  return `<span class='keyword'>${w}</span>`;
}

function htype(w: string): string {
  return `<span class='type'>${w}</span>`;
}

function hvaluedef(w: string): string {
  return `<span class='value-definition'>${w}</span>`;
}

function hconstant(w: string): string {
  return `<span class='constant'>${w}</span>`;
}

function hstring_constant(w: string): string {
  return `<span class='string-constant'>${w}</span>`;
}

function hbool_constant(w: string): string {
  return `<span class='bool-constant'>${w}</span>`;
}

function div(w: string, class_?: string): string {
  if (class_)
    return `<div class='${class_}'>${w}</div>`;
  else
    return `<div>${w}</div>`;
}

interface GoalStateDocumentDelegate {
  getFileData(): Promise<Uint8Array>;
}

class GoalStateConverter {
  private _abort_signal: AbortSignal | undefined;
  private _po: IX.ProofObligation | undefined;

  constructor(abort_signal?: AbortSignal) {
    this._abort_signal = abort_signal;
  }

  applied_symbol2html(s: IX.AppliedSymbol, type: string, definition?: string, hover_enabled = true): string {
    this._abort_signal?.throwIfAborted();

    const id = s.id;
    const slash_inx = id.lastIndexOf("/");
    let hover: string | undefined = hover_enabled ? hvaluedef(id) + " : " + htype(type) : undefined;
    if (hover_enabled && definition) hover += definition;
    if (slash_inx < 0)
      return span(id, hover);
    else
      return span(id.slice(0, slash_inx), hover);
  }

  const2html(c: IX.Constant, type: string, hover_enabled: boolean): string {
    this._abort_signal?.throwIfAborted();

    let r = "";
    switch (c.view.constructor) {
      case "Const_float": r = hconstant(c.view.v.toString()); break;
      case "Const_string": r = hstring_constant(`"${c.view.v}"`); break;
      case "Const_z": r = hconstant(c.view.v.toString()); break;
      case "Const_q": {
        let q = c.view.num.toString() + ".0";
        if (c.view.den != "1")
          q = `${q} /. ${c.view.den.toString()}.0`;
        r = "(" + hconstant(q) + ")";
        break;
      }
      case "Const_real_approx": r = hconstant(c.view.v); break;
      case "Const_uid": r = hconstant(c.view.v); break;
      case "Const_bool": r = hbool_constant(c.view.v ? "true" : "false"); break;
      default:
        r = JSON.stringify(c);
    }
    return span(r, hover_enabled ? r + " : " + htype(type) : undefined);
  }

  term2html(t: IX.Term, hover_enabled = true): string {
    this._abort_signal?.throwIfAborted();

    const rec = (x: IX.Term) => this.term2html(x, hover_enabled);
    const rec_nohover = (x: IX.Term) => this.term2html(x, false);
    const sts = (x: string, h?: string): string => { return hover_enabled ? span(x, h) : span(x) };
    const sdiv = (x: string): string => div(x, "subterm");
    try {
      switch (t.view.constructor) {
        case "Const":
          return this.const2html(t.view.c, t.type, hover_enabled);
        case "If":
          return sdiv(
            sdiv(hkw("if") + " " + rec(t.view.c)) + " " +
            sdiv(hkw("then") + " " + rec(t.view.t)) + " " +
            sdiv(hkw("else") + " " + rec(t.view.f)));
        case "Apply": {
          let f = rec(t.view.f);
          if (t.view.f.view.constructor == "Sym" && this._po)
            f = cmdspan(rec(t.view.f), "expandable", { id: t.view.f.view.sym.id, po_anchor: this._po?.anchor });
          if (t.view.l.length == 0)
            return sts(f);
          else
            return sts("(" + f + " " + t.view.l.map(rec).join(" ") + ")");
        }
        case "Var": {
          const id = t.view.id;
          const slash_inx = id.lastIndexOf("/");
          if (slash_inx < 0)
            return sts(id, id + " : " + htype(t.type));
          else {
            return sts(id.slice(0, slash_inx), id + " : " + htype(t.type));
          }
        }
        case "Sym": {
          const s: IX.AppliedSymbol = t.view.sym;
          const fnd = this._po?.definitions.find((x: IX.Definition) => x.name == s.id);
          if (fnd) {
            const extra = " =<br/>" + sdiv(hkw("fun")) + " " + fnd.vars.join(" ") + " -> " + rec_nohover(fnd.body);
            return this.applied_symbol2html(s, t.type, extra, hover_enabled);
          }
          else
            return this.applied_symbol2html(s, t.type, undefined, hover_enabled);
        }
        case "Construct": {
          if (t.view.args.length == 0)
            return this.applied_symbol2html(t.view.c, t.type, undefined, hover_enabled);
          else {
            const c = this.applied_symbol2html(t.view.c, t.type, undefined, hover_enabled);
            const args_html = t.view.args.map(rec).join(" ");
            return sts(`(${c} ${args_html})`);
          }
        }
        case "Destruct":
          return sts(`destruct(${t.view.c.id}, ${t.view.i}, ${rec(t.view.t)})`);
        case "Is_a":
          return sdiv(`(${rec(t.view.t)} ${hkw("is_a")} ${t.view.c.id})`);
        case "Tuple": {
          return sts("(" + t.view.l.map(rec).join(", ") + ")");
        }
        case "Field":
          return sts(`(${rec(t.view.t)}).${t.view.f.id}`);
        case "Tuple_field":
          return sts(`(${rec(t.view.t)}).[${t.view.i}]`);
        case "Record": {
          const rows_html = t.view.rows.map(([sym, term]) => `${sym.id}: ${rec(term)}`).join("; ");
          const rest_html = t.view.rest ? ` | ${rec(t.view.rest)}` : "";
          return sts(`{${rows_html}${rest_html}}`);
        }
        case "Case": {
          const cases_html = t.view.cases.map(([sym, term]) => `${sym.id} => ${rec(term)}`).join(" | ");
          const default_html = t.view.default ? ` | _ => ${rec(t.view.default)}` : "";
          return sts(hkw("case") + `(${rec(t.view.u)}) { ${cases_html}${default_html} }`);
        }
        case "Sequence": {
          const s_html = t.view.s[0].map(rec).join("; ");
          return sts(`(${s_html}; ${rec(t.view.s[1])})`);
        }
        default:
          return sts(`Unknown term view: ${JSON.stringify(t.view)}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return sts(`Error "${e}" while converting term "${JSON.stringify(t.view)}"`)
    }
  }

  turnstile(): string {
    return "<div class='code-like'>|---</div>";
  }

  subgoal2html(sg: IX.Sequent | string): string {
    this._abort_signal?.throwIfAborted();

    if (typeof sg === "string")
      return sg;
    else {
      const hyps = sg.hypotheses.map(h => { const thtml = this.term2html(h.term); if (h.name) return `${h.name}: ${thtml}`; else return thtml; });
      const concls = sg.conclusions.map(c => { const thtml = this.term2html(c.term); if (c.name) return `${c.name}: ${thtml}`; else return thtml; });
      const hyps_html = hyps.map(x => "<div class='code-like'>" + x + "</div>");
      const concls_html = concls.map(x => "<div class='code-like'>" + x + "</div>");
      return hyps_html.join("") + this.turnstile() + concls_html.join("");
    }
  }

  subgoals2html(sgs: (IX.Sequent | string)[]): string {
    this._abort_signal?.throwIfAborted();

    if (sgs.length == 0)
      return "";
    else if (sgs.length == 1)
      return this.subgoal2html(sgs[0]);
    else {
      const sgs_html = sgs.map(x => this.subgoal2html(x)).map(x => `<li>${x}</li>`).join("");
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
    if (sr.res)
      r += `<tr><td valign=top>Result:</td><td>${sr.res}</td></tr>`;
    if (sr.subanchor)
      r += `<tr><td valign=top>Sub-anchor:</td><td><div>${sr.subanchor.name}/${sr.subanchor.anchor}</div></td></tr>`;
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
      const srs_html = srs.map(x => this.subresult2html(x)).map(x => `<li>${x}</li>`).join("");
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
      const srs_html = srs.map(x => this.subresults2html(x)).map(x => `<li>${x}</li>`).join("");
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

  errors2html(errors: string[]): string {
    this._abort_signal?.throwIfAborted();

    return errors.map(x => {
      this._abort_signal?.throwIfAborted();
      return `<div class='code-like'>${x.replaceAll('\n', '<br/>')}</div>`
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
      title = `<a href='#' class='jump-to' arguments='${JSON.stringify(cmd_args)}'>${po.name}</a>`;
    } else
      title = `${po.name}`;
    title += "</span>";
    title = `<span>${title}<span class='focus-lock-icon' po_anchor='${po.anchor}'><i class="codicon codicon-unlock"></i></span></span>`;
    if ((po.subgoals?.length > 0) || (po.subresults?.length > 0) || (po.errors?.length > 0)) {
      let r = title;
      if (po.subgoals?.length > 1)
        r += "<h3>Subgoals:</h3>"
      const sgs_html = this.subgoals2html(po.subgoals);
      r += `${sgs_html}`;
      if (po.subresults?.length > 0) {
        const srs_html = this.subresultss2html(po.subresults);
        r += `<details><summary>Subresults</summary><ul>${srs_html}</ul></details>`;
      }
      if (po.errors?.length > 0) {
        r += `<details><summary>Errors (${po.errors.length})</summary><ul>${this.errors2html(po.errors)}</ul></details>`;
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
    return po.subgoals?.length == 0 && po.subresults?.length == 0 && po.errors?.length == 0;
  }

  isUnattempted(po: IX.ProofObligation): boolean {
    return po.report === undefined;
  }

  async to_html(data: IX.GoalState): Promise<string> {
    return new Promise((resolve, reject) => {
      this._abort_signal?.throwIfAborted();

      this._abort_signal?.addEventListener("abort", () => {
        reject(this._abort_signal?.reason as Error);
      },
        { once: true });

      setTimeout((gsc: GoalStateConverter) => {
        const config = workspace.getConfiguration("imandrax");
        let r = "";
        let pos = data.proof_obligations
        if (config.showProvenGoals == false)
          pos = pos.filter(po => !gsc.isProven(po));
        if (config.showUnattemptedGoals == false)
          pos = pos.filter(po => !gsc.isUnattempted(po));
        if (pos.length > 0) {
          r += "<h1>Proof obligations</h1>\n";
          r += "<p><ul>\n" +
            pos.map(x => {
              gsc._abort_signal?.throwIfAborted();
              return `<li>${gsc.proof_obligation2html(x)}</li>`;
            }).join("\n")
            + "</ul></p>\n";
        }
        else
          r += "<ul><li><h2>Nothing as of yet.</h2></li><ul>";

        resolve(r);
      }, 0, this);
    });
  }
}

export class GoalStateDocument extends Disposable implements CustomDocument {
  private readonly _uri: Uri;
  private _documentData = "";
  private _goalStateData: IX.GoalState | undefined = undefined;
  private readonly _delegate: GoalStateDocumentDelegate;
  private _file_watcher: FileSystemWatcher;
  private _abort_controller: AbortController | undefined;

  private constructor(
    uri: Uri,
    data: Uint8Array,
    delegate: GoalStateDocumentDelegate
  ) {
    super(() => { return; });
    const txtdec = new TextDecoder();
    this._uri = uri;
    if (data) {
      const gsc = new GoalStateConverter();
      gsc.to_html(JSON.parse(txtdec.decode(data)) as IX.GoalState).then(
        x => { this._documentData = x }
      ).catch(() => { this._documentData = "" })
    }
    this._delegate = delegate;
    this._file_watcher = workspace.createFileSystemWatcher(new RelativePattern(uri, '*'));
    this._file_watcher.onDidChange(async uri => {
      try {
        if (this._abort_controller && !this._abort_controller.signal.aborted)
          this._abort_controller.abort();

        const content_bytes = await GoalStateDocument.readFile(uri);
        const content_string = txtdec.decode(content_bytes);
        if (content_string !== "") {
          this._goalStateData = JSON.parse(content_string) as IX.GoalState; // Todo: Proper type check with ts-json-object or similar?

          this._abort_controller = new AbortController();
          const gsc = new GoalStateConverter(this._abort_controller.signal);
          await gsc.to_html(JSON.parse(content_string) as IX.GoalState).then(x => {
            this._documentData = x;
            this._abort_controller = undefined;
          });
        }
        else {
          this._documentData = "<div class='code-like'>&#x25A0</div>";
        }

        this._onDidChangeDocument.fire({ content: this._documentData });
      }
      catch (e) {
        if (e !== null && typeof e === 'object' && "name" in e && e.name == "AbortError")
          this._abort_controller = undefined;
        else
          console.log(`Caught exception while updating goal state view: ${JSON.stringify(e)}`);
      }
    });
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

  async expand(id: string, po_anchor: string) {
    const po = this._goalStateData?.proof_obligations.find(x => x.anchor == po_anchor);
    if (po) {
      const loc: IX.SourceLocation | undefined = po.byLocation ?? po.location;
      if (loc) {
        const uri = Uri.parse(po.byLocation ? po.byLocation.uri : loc.uri);
        const by_rng = sourcelocation2range(loc);
        const insert_pos = by_rng.end.translate(0, 1);
        const sid = short_id(id);
        const new_txt = po.byLocation ? ` @> expand "${sid}"` : ` [@@by expand "${sid}"]`;
        await workspace.openTextDocument(uri).then(doc => {
          if (doc.isDirty) {
            window.showErrorMessage("Cannot add to @@by attribute because the document has unsaved changes.");
          } else
            window.showTextDocument(doc, ViewColumn.One, false).then(editor => {
              editor.edit(edit => {
                edit.insert(insert_pos, new_txt);
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
      console.log(`PO ${po_anchor} not found`);
    return;
  }
}