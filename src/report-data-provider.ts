import * as vscode from 'vscode';
import * as fs from 'fs';

import * as twine from "imandrax-api/twine";
import * as api from "imandrax-api/types";

function parse_report(filename: string): api.Report_Report {
  console.log(`Filename: ${filename}`);
  const startTime = performance.now();
  const stats = fs.statSync(filename);
  const buffer = Buffer.alloc(stats.size);
  const fd = fs.openSync(filename, "r");
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  const endTime = performance.now();
  console.log(`File I/O time: ${endTime - startTime} ms`);
  console.log(`Buffer length: ${buffer.length}`);
  // console.log(`Buffer: ${buffer.toString("hex")}`);

  try {
    const startTime = performance.now();
    const dec = new twine.Decoder(buffer);
    const ep = dec.entrypoint();
    const report = api.Report_Report_of_twine(dec, ep);
    const endTime = performance.now();
    console.log(`Decoding time: ${endTime - startTime} ms`);
    console.log(`Decoded ${report.events.length} events`);
    return report;
  }
  catch (ex) {
    console.log(`Exception thrown while decoding: ${ex}`);
  }

  return undefined;
}

function to_string(arg): string {
  if (arg) {
    if (typeof arg === 'string' || arg instanceof String)
      return arg as string;
    else if (arg instanceof Array) {
      return arg.map(arg => { return to_string(arg); }).join(", ");
    } else
      // if (arg instanceof api.Mir_Term)
      //   return term_to_string(arg);
      // else
      if (arg instanceof api.Report_Smt_proof)
        return "(" + arg.expansions.length + "expansions, " + arg.instantiations.length + " instantiations)";
      else if (arg instanceof api.Report_Rtext_item_S)
        return to_string(arg.arg);
      else if (arg instanceof api.Report_Rtext_item_B)
        return arg.arg;
      // else if (arg instanceof api.Report_Rtext_item_Term)
      //   return term_to_string(arg.arg);
      else if (arg instanceof api.Report_Rtext_item_Sequent)
        return "SEQUENT";
      else if (arg instanceof api.Report_Rtext_item_Sub)
        return to_string(arg.arg[0]) + "...";
      else if (arg instanceof api.Report_Rtext_item_L)
        return to_string(arg.arg);
      else if (arg instanceof api.Report_Rtext_item_Uid)
        return to_string(arg.arg.name);
      else
        return "?";
  }
  else {
    return "UNDEFINED";
  }
}


export class ReportItem extends vscode.TreeItem {
  constructor(
    public label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public description: string = "",
    public event: api.Report_Atomic_event_Mir | api.Report_Event_t_linear_EL_enter_span<api.Report_Atomic_event_Mir> | undefined = undefined,
    public contextValue: string | undefined = undefined
  ) {
    super(label, collapsibleState);
    this.tooltip = this.label;
    this.description = description;
  }

  public children: Array<ReportItem> = new Array<ReportItem>();

  // iconPath = {
  //   light: path.join(...),
  //   dark: path.join(...)
  // };
}

function atomic_event_to_report_item(event: api.Report_Atomic_event_Mir): ReportItem {
  if (event instanceof api.Report_Atomic_event_poly_E_message) {
    if (event.arg instanceof Array) {
      if (event.arg.length == 1) {
        return new ReportItem(to_string(event.arg[0]), vscode.TreeItemCollapsibleState.Collapsed, "", event);
      }
      else {
        const fst = event.arg[0];
        if (fst instanceof api.Report_Rtext_item_B && fst.arg == "Goal:" && event.arg.length == 3) {
          const r = new ReportItem("Goal", vscode.TreeItemCollapsibleState.None, "", event, "goal");
          // r.children = event.arg.slice(1).map(a => new ReportItem(to_string(a), vscode.TreeItemCollapsibleState.None));
          return r;
        }
        else {
          const r = new ReportItem(to_string(fst), vscode.TreeItemCollapsibleState.Collapsed, "", event);
          r.children = event.arg.slice(1).map(a => new ReportItem(to_string(a), vscode.TreeItemCollapsibleState.None));
          return r;
        }
      }
    }
    else
      return new ReportItem(to_string(event.arg), vscode.TreeItemCollapsibleState.Collapsed, "", event);
  }
  else if (event instanceof api.Report_Atomic_event_poly_E_proved_by_smt) {
    const arg = to_string(event.args);
    return new ReportItem("By SMT", vscode.TreeItemCollapsibleState.Collapsed, arg, event);
  }
  else if (event instanceof api.Report_Atomic_event_poly_E_attack_subgoal) {
    const r = new ReportItem(`Subgoal ${event.name}`, vscode.TreeItemCollapsibleState.Collapsed, "", event, "subgoal");
    return r;
  }
  else if (event instanceof api.Report_Atomic_event_poly_E_enter_tactic) {
    return new ReportItem(to_string(event.arg), vscode.TreeItemCollapsibleState.Collapsed, "", event);
  }
  else if (event instanceof api.Report_Atomic_event_poly_E_enter_waterfall) {
    return new ReportItem("Waterfall", vscode.TreeItemCollapsibleState.Collapsed, "", event);
  }
  else {
    return new ReportItem("?", vscode.TreeItemCollapsibleState.Collapsed, "", event);
  }
}

function event_to_report_item(event: api.Report_Event_t_linear_EL_atomic<api.Report_Atomic_event_Mir>): ReportItem {
  if (event instanceof api.Report_Event_t_linear_EL_atomic) {
    return atomic_event_to_report_item(event.ev);
  }
  else {
    return new ReportItem("?", vscode.TreeItemCollapsibleState.Collapsed, "", event);
  }
}

export class ReportDataProvider implements vscode.TreeDataProvider<ReportItem> {
  private report: api.Report_Report | undefined = undefined;
  private top: ReportItem | undefined = undefined;
  private filename: string | undefined = undefined;

  constructor() { }

  public load(filename: string) {
    this.filename = filename;
    this.top = undefined;
    this.report = parse_report(filename);
  }

  getTreeItem(element: ReportItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ReportItem): Thenable<ReportItem[]> {
    if (!this.report) {
      return Promise.resolve([]);
    }

    if (element) {
      return Promise.resolve(element.children);
    } else {
      if (!this.top) {
        let i = 0, spans = 0;
        const name = (this.filename) ? this.filename.slice(-16) : "";
        const top = new ReportItem(`Report ...${name}`, vscode.TreeItemCollapsibleState.Expanded, "");
        const scopes: ReportItem[] = [];
        this.report.events.forEach((event: api.Report_Event_t_linear<api.Report_Atomic_event_Mir>) => {
          try {
            if (event instanceof api.Report_Event_t_linear_EL_enter_span) {
              spans++;
              i++;
              scopes.push(atomic_event_to_report_item(event.ev));
            }
            else if (event instanceof api.Report_Event_t_linear_EL_exit_span) {
              i--;
              const x = scopes.pop();
              if (x) {
                x.collapsibleState = x.children.length == 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;
                if (scopes.length == 0)
                  top.children.push(x);
                else
                  scopes[scopes.length - 1].children.push(x);
              }
            }
            else if (scopes.length > 0) {
              scopes[scopes.length - 1].children.push(event_to_report_item(event));
            }
            else {
              top.children.push(event_to_report_item(event));
            }
          }
          catch (ex) { console.log(`Exception thrown while decoding: ${ex}`); }
        });
        if (i != 0)
          top.children.push(new ReportItem(`${i} unclosed scopes`, vscode.TreeItemCollapsibleState.None, "", undefined));
        this.top = top;
      }
      return Promise.resolve([this.top]);
    }
  }

  private _onDidChangeTreeData: vscode.EventEmitter<ReportItem | undefined | null | void> = new vscode.EventEmitter<ReportItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReportItem | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}