import { TextDocumentShowOptions, Uri, ViewColumn } from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import sanitize = require('sanitize-html');

import { Config } from "../config"

import * as IX from "./imandrax_types"
import * as IXRE from "./imandrax_report_event"
import * as TermFormatter from "./term-formatter";
import * as SequentFormatter from "./term-formatter";

function capitalize(x: string): string {
  if (x.length == 0)
    return x;
  else
    return x.charAt(0).toUpperCase() + x.slice(1);
}

function div(class_: string, content: string): string {
  return `<div class='${class_}'>` + content + "</div>";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function is_bool_true(x: any): boolean {
  return (typeof x === 'boolean') && x;
}

export class Options {
  num_columns: number;
  showProvenGoals = false;
  hideDefaultNames = false;
  stripModuleScope = false;

  constructor(num_columns: number, showProvenGoals: boolean, hideDefaultNames: boolean, stripModuleScope: boolean) {
    this.num_columns = num_columns;
    this.showProvenGoals = showProvenGoals;
    this.hideDefaultNames = hideDefaultNames;
    this.stripModuleScope = stripModuleScope;
  }

  static from_config(num_columns: number, config: Config): Options {
    const r = new Options(num_columns, is_bool_true(config.showProvenGoals), is_bool_true(config.hideDefaultNames), config.stripModuleScope);
    return r;
  }
}

export class MetaData {
  only_anchor: string | undefined; // Anchor in case there is only one item/PO displayed
}

class Context {
  goal: IX.Goal | undefined;
}

export class Converter {
  private _options: Options;
  private _abort_signal: AbortSignal | undefined;

  constructor(options: Options, abort_signal?: AbortSignal) {
    this._options = options;
    this._abort_signal = abort_signal;
  }

  turnstile(): string {
    // return "<div class='turnstile'>|---</div>";
    return "<svg class='turnstile' viewbox='0 0 60 20'><use href='#turnstile-svg'/></svg>"
  }

  async term2html(t: IX.Term, ctx: Context, with_turnstile?: boolean): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const fmttd: string = TermFormatter.prettify(this._options.num_columns, t, ctx.goal, this._abort_signal, with_turnstile);
    const r = fmttd
      .replaceAll("\t", "<span class='indent'></span>")
      .replaceAll("\n", "<br/>") +
      "<br/>";
    return Promise.resolve(r);
  }

  async namedTerm2html(h: IX.NamedTerm, default_name: string | undefined, ctx: Context, with_turnstile?: boolean): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const trm = await this.term2html(h.term, ctx, with_turnstile);
    let r;
    if (h.name)
      r = `${h.name}: ${trm}`;
    else if (!this._options.hideDefaultNames && default_name)
      r = `${default_name}: ${trm}`;
    else
      r = trm;
    r = "<div class='code-like'>" + r + "</div>";
    return Promise.resolve(r);
  }

  async sequent2html(sg: IX.Sequent, ctx: Context): Promise<string> {
    this._abort_signal?.throwIfAborted();

    let r = SequentFormatter.prettify_sequent(this._options.num_columns, sg, ctx.goal, this._abort_signal, this.turnstile(), true, this._options.stripModuleScope);
    r = r
      .replaceAll("\t", "<span class='indent'></span>")
      .replaceAll("\n", "<br/>") +
      "<br/>";
    r = "<div class='code-like sequent'>" + r + "</div>";
    return Promise.resolve(r);
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
    if (sr.error) {
      const error = sr.error.replaceAll('\n', '<br/>');
      r += `<tr><td valign=top>Error:</td><td>${error}</td></tr>`;
    }
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
    return Promise.resolve(r.replaceAll('\n', '<br/>'));
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

  async goal2html(goal: IX.Goal, multiple_in_modules: boolean, index_in_file: number): Promise<string> {
    this._abort_signal?.throwIfAborted();

    const qed = "&#x25A0";
    let title;
    const ctx: Context = { goal: goal };
    if (goal.location) {
      let name = goal.name
      if (multiple_in_modules) {
        const slash_inx = goal.location.uri.lastIndexOf('/');
        if (slash_inx >= 0 && slash_inx < goal.location.uri.length) {
          const filename = goal.location.uri.substring(slash_inx + 1);
          const dot_inx = filename.lastIndexOf(".");
          const module = capitalize(dot_inx > 0 ? filename.substring(0, dot_inx) : filename);
          name = `${module}.${name}`
        }
      }
      if (index_in_file > 0)
        name = name + ` (#${index_in_file})`;
      const loc_uri = Uri.parse(goal.location.uri);
      const opts = { viewColumn: ViewColumn.One, preserveFocus: false } as TextDocumentShowOptions;
      const cmd_args = {
        uri: loc_uri, options: opts,
        location: {
          from: { line: Number(goal.location.from.line), column: Number(goal.location.from.column) },
          to: { line: Number(goal.location.to.line), column: Number(goal.location.to.column) }
        }
      };
      title = `<a href='#/' class='jump-to' arguments='${JSON.stringify(cmd_args)}'>${name}</a>`;
      const vars = goal.vars.join(" ");
      title = `<span class='hoverable' data-hover='${goal.name} ${vars}'>${title}</span>`;
    } else
      title = `${goal.name}`;
    if (goal.outdated) {
      title += "<i class='codicon codicon-warning ttl-warning hoverable' data-hover='Outdated. Either the goal itself or its state are out of date. This usually means that the goal has been changed, removed, or that there are syntax errors in the source file.'></i>"
    }
    title = `${title}<div class='focus-lock-icon' anchor="${sanitize(goal.anchor)}"><i class="codicon codicon-unlock"></i></div>`;
    title = `<div class='goal-info'><div class='goal-title'>${title}</div></div>`;

    let r = "";
    if ((goal.subgoals?.length > 0) || (goal.subresults?.length > 0) || (goal.errors?.length > 0)) {
      if (goal.subgoals?.length > 1)
        r += `<h3>Subgoals (${goal.subgoals.length}):</h3>`
      const sgs_html = await this.subgoals2html(goal.subgoals, ctx);
      r += `${sgs_html}`;
      if (goal.errors?.length > 0) {
        let opened = "";
        if (goal.errors?.length == 1)
           opened = " open";
        r += `<details${opened}><summary>Problems (${goal.errors.length})</summary><ul>${await this.errors2html(goal.errors)}</ul></details>`;
      }
      if (goal.subresults?.length > 0) {
        const srs_html = await this.subresultss2html(goal.subresults, ctx);
        r += `<details><summary>Subresults</summary><ul>${srs_html}</ul></details>`;
      }
      if (goal.report && goal.report.events?.length > 0) {
        r += `<details><summary>Report</summary><ul>${await this.report2html(goal.report, ctx)}</ul></details>`;
      }
    }
    else
      r += `<div class='goal-content'>${qed}</div>`;

    return Promise.resolve(`${title}<div class='goal-content'>${r}</div>`);
  }

  isProven(goal: IX.Goal): boolean {
    return goal.subgoals?.length == 0 && goal.errors?.length == 0;
  }


  goal_counts(goals: IX.Goal[]): Map<string | undefined, Map<string, number>> {
    const r = new Map<string | undefined, Map<string, number>>();
    goals.forEach(goal => {
      const at_uri = r.get(goal.location?.uri);
      if (!at_uri) {
        r.set(goal.location?.uri, new Map([[goal.name, 1]]));
      }
      else {
        const at_name = at_uri.get(goal.name);
        if (!at_name)
          r.set(goal.location?.uri, at_uri.set(goal.name, 1));
        else
          r.set(goal.location?.uri, at_uri.set(goal.name, at_name + 1));
      }
    }
    );
    return r;
  }

  async to_html(data: IX.GoalState): Promise<[string, MetaData]> {
    const metadata: MetaData = new MetaData();
    let r = "";

    let goals = data.goals;
    if (!this._options.showProvenGoals)
      goals = goals.filter(po => !this.isProven(po));

    metadata.only_anchor = goals.length == 1 ? goals[0].anchor : undefined;

    if (goals.length > 0) {
      goals = goals.sort((x, y) => {
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

      const counts = this.goal_counts(goals);
      const done = new Map<string, number>();

      const gs = goals.map(async goal => {
        const at_uri = counts.get(goal.location?.uri);
        const num_in_same_module = at_uri?.get(goal.name) ?? 0; // Number of times the PO name appears in the current module
        let num_modules_with_name = 0; // Number of modules in which this PO name appears
        for (const [_, value] of counts)
          if (value.get(goal.name))
            num_modules_with_name++;

        const longname = goal.location?.uri + "." + goal.name;
        const inx_in_same_module = done.get(longname) ?? (num_in_same_module == 1 ? 0 : 1); // Index of the PO name in the current module
        done.set(longname, inx_in_same_module + 1);
        return await this.goal2html(goal, num_modules_with_name > 1, inx_in_same_module);
      });
      r += "<p>\n" +
        (await Promise.all(gs.map(async x => { return div("goal", await x); }))).join("\n")
        + "</p>\n";
    }
    else
      r += div("goal", div("goal-info", div("goal-title", "Nothing as of yet.")));

    return [r, metadata];
  }
}