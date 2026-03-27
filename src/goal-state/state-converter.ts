import { TextDocumentShowOptions, Uri, ViewColumn } from 'vscode';

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

export class Options {
  showProvenGoals = false;
  showUnattemptedGoals = false;

  constructor(showProvenGoals: boolean, showUnattemptedGoals: boolean) {
    this.showProvenGoals = showProvenGoals;
    this.showUnattemptedGoals = showUnattemptedGoals;
  }
}

export class MetaData {
  only_anchor: string | undefined; // Anchor in case there is only one item/PO displayed
}

class Context {
  po: IX.ProofObligation | undefined;
}

export class Converter {
  private _abort_signal: AbortSignal | undefined;
  private _num_columns: number;

  constructor(num_columns: number, abort_signal?: AbortSignal) {
    this._num_columns = num_columns;
    this._abort_signal = abort_signal;
  }

  turnstile(): string {
    return "<div class='turnstile'>|---</div>";
  }

  async term2html(t: IX.Term, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const fmttd: string = TermFormatter.prettify(this._num_columns, t, ctx.po);
    const r = fmttd
      .replaceAll("\t", "<span class='indent'></span>")
      .replaceAll("\n", "<br/>") +
      "<br/>";
    return Promise.resolve(r);
  }

  async namedTerm2html(h: IX.NamedTerm, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const trm = await this.term2html(h.term, ctx);
    let r;
    if (h.name)
      r = `<div class='code-like'>${h.name}: ${trm}</div>`;
    else
      r = `<div class='code-like'>${trm}</div>`;
    return Promise.resolve(r);
  }

  async sequent2html(sg: IX.Sequent, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const hyps = await Promise.all(sg.hypotheses.map(async x => await this.namedTerm2html(x, ctx)));
    const concls = await Promise.all(sg.conclusions.map(async x => this.namedTerm2html(x, ctx)));
    return Promise.resolve(hyps.join("") + this.turnstile() + concls.join(""));
  }

  async subgoal2html(sg: IX.Sequent | string, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    if (typeof sg === "string")
      return Promise.resolve(sg);
    else
      return await this.sequent2html(sg, ctx);
  }

  async subgoals2html(sgs: (IX.Sequent | string)[], ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    let r;
    if (sgs.length == 0)
      r = "";
    else if (sgs.length == 1)
      r = this.subgoal2html(sgs[0], ctx);
    else {
      const sgsp = await Promise.all(sgs.map(async x => await this.subgoal2html(x, ctx)));
      const sgs_html = sgsp.map(x => `<li>${x}</li>`).join("");
      r = `<ul>${sgs_html}</ul>`;
    }

    return Promise.resolve(r);
  }

  async subresult2html(sr: IX.Subresult, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    let r = "<span><table>";
    if (sr.goal)
      r += `<tr><td valign=top>Goal:</td><td>${await this.subgoal2html(sr.goal, ctx)}</td></tr>`;
    if (sr.subgoals)
      r += `<tr><td valign=top>Subgoals:</td><td>${await this.subgoals2html(sr.subgoals, ctx)}</td></tr>`;
    if (sr.error)
      r += `<tr><td valign=top>Error:</td><td>${sr.error}</td></tr>`;
    r += "</table></span>"

    return Promise.resolve(r);
  }

  async subresults2html(srs: IX.Subresult[], ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    if (srs.length == 0)
      return "";
    else if (srs.length == 1)
      return await this.subresult2html(srs[0], ctx);
    else {
      const srsp = await Promise.all(srs.map(async x => await this.subresult2html(x, ctx)));
      const srs_html = srsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${srs_html}</ul>`;
    }
  }

  async subresultss2html(srs: IX.Subresult[][], ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    if (srs.length == 0)
      return "";
    else if (srs.length == 1)
      return await this.subresults2html(srs[0], ctx);
    else {
      const srsp = await Promise.all(srs.map(async x => await this.subresults2html(x, ctx)));
      const srs_html = srsp.map(x => `<li>${x}</li>`).join("");
      return `<ul>${srs_html}</ul>`;
    }
  }

  async report_event2html(e: IXRE.ReportEvent, ctx: Context): Promise<string> {
    let r: string;
    const d: IXRE.Description = e.description;
    const t2h = (x: IX.Term) => { return this.term2html(x, ctx); };
    switch (d.constructor) {
      case "E_message": r = `${d.message.replace(/^"|"$/g, "")}`; break;
      case "E_title": r = `${d.title.replace(/^"|"$/g, "")}`; break;
      case "E_enter_waterfall": r = `Enter waterfall; variables: [${d.vars.join(", ")}], goal:<br/><div class='indented'>${await t2h(d.goal)}</div>`; break;
      case "E_enter_tactic": r = `Enter tactic "${d.tactic}"`; break;
      case "E_rw_success": r = `Rewriting success: by '${d.rule}' from ${await t2h(d.from)} to ${await t2h(d.to)}`; break;
      case "E_rw_fail": r = `Rewriting failure: by '${d.rule}' from ${await t2h(d.term)} because '${d.reason}'`; break;
      case "E_inst_success": r = `Instantiation success: by '${d.rule}' obtain ${await t2h(d.term)}`; break;
      case "E_waterfall_checkpoint": {
        const cs = await Promise.all(d.checkpoints.map(x => this.sequent2html(x, ctx)));
        if (cs.length == 0)
          r = `Waterfall checkpoints: <empty>`;
        else if (cs.length == 1)
          r = `Waterfall checkpoint: ${cs[0]}`;
        else
          r = `Waterfall checkpoints: ${cs.join("<br/>")}`;
        break;
      }
      case "E_induction_scheme": r = `Induction scheme: ${await t2h(d.scheme)}`; break;
      case "E_attack_subgoal": r = `Subgoal ${d.name} (depth ${d.depth}):<br/><span class='indented'>${await this.sequent2html(d.goal, ctx)}<span>`; break;
      case "E_simplify_t": r = `Simplify ${await t2h(d.from)} into ${await t2h(d.to)}`; break;
      case "E_simplify_clause": {
        const to_ = await Promise.all(d.to.map(x => t2h(x)));
        r = `Simplify clause ${await t2h(d.from)} into ${to_.join("")}`;
        break;
      }
      case "E_proved_by_smt": r = `Proved by SMT; Proof: ${d.proof}`; break;
      case "E_refuted_by_smt": r = `Refuted by SMT; Model: <div class='code-like'>${d.model}</div>`; break;
      case "E_fun_expansion": r = `Expand ${await t2h(d.from)} into ${await t2h(d.to)}`; break;
      default:
        r = JSON.stringify(d);
    }
    return Promise.resolve(r);
  }

  async report2html(rep: IX.Report, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    return (await Promise.all(rep.events.map(async (event: IXRE.ReportEvent) => {
      let res = `<div>${await this.report_event2html(event, ctx)}</div>`;
      if (event.sub_report && event.sub_report.events.length > 0) {
        res += await this.report2html(event.sub_report, ctx);
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
    const ctx: Context = { po };
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
      const sgs_html = await this.subgoals2html(po.subgoals, ctx);
      r += `${sgs_html}`;
      if (po.errors?.length > 0) {
        r += `<details><summary>Problems (${po.errors.length})</summary><ul>${await this.errors2html(po.errors)}</ul></details>`;
      }
      if (po.subresults?.length > 0) {
        const srs_html = await this.subresultss2html(po.subresults, ctx);
        r += `<details><summary>Subresults</summary><ul>${srs_html}</ul></details>`;
      }
      if (po.report && po.report.events?.length > 0) {
        r += `<details><summary>Report</summary><ul>${await this.report2html(po.report, ctx)}</ul></details>`;
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

  async to_html(data: IX.GoalState, options: Options): Promise<[string, MetaData]> {
    const metadata: MetaData = new MetaData();
    let r = "";
    let pos = data.proof_obligations
    if (options.showProvenGoals == false)
      pos = pos.filter(po => !this.isProven(po));
    if (options.showUnattemptedGoals == false)
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
    else
      r += "<ul><li><h2>Nothing as of yet.</h2></li><ul>";

    return [r, metadata];
  }
}