import {
  Disposable,
  ExtensionContext,
  TextDocumentShowOptions,
  Uri,
  ViewColumn,
  Webview,
  WebviewPanel,
  window,
} from 'vscode';

import { getExtensionConfig } from '../../config';
import { jumpTo, jumpToDeclaration } from '../document';
import * as EditorMessages from '../editor_messages';
import * as IX from '../imandrax_types';
import * as GSC from '../state-converter';
import * as PS from './proof_steps';
import { StepState } from './session';

// A webview beside the editor that shows the subgoal and the results of the
// current proof step, formatted like the goal state. It reuses the goal
// state's script and styles (media/goal_state.{js,css}).

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;").replaceAll("\"", "&quot;");
}

/** A section, like the goal state's (e.g. its "Subresults"), but open. */
function section(summary: string, content: string): string {
  return `<details open><summary>${summary}</summary><ul>${content}</ul></details>`;
}

/** A link that jumps to `loc`, handled by goal_state.js like the goal state's links. */
function jumpLink(text: string, loc: IX.SourceLocation | undefined): string {
  if (!loc)
    return escapeHtml(text);
  const args = {
    uri: Uri.parse(loc.uri),
    options: { viewColumn: ViewColumn.One, preserveFocus: false } as TextDocumentShowOptions,
    location: {
      from: { line: Number(loc.from.line), column: Number(loc.from.column) },
      to: { line: Number(loc.to.line), column: Number(loc.to.column) },
    },
  };
  return `<a href='#/' class='jump-to' arguments='${JSON.stringify(args).replaceAll("'", "&#39;")}'>${escapeHtml(text)}</a>`;
}

export class ProofStepView implements Disposable {
  public static readonly viewType = "imandrax.ProofStep";

  private _panel: WebviewPanel | undefined;
  private _state: StepState | undefined;
  private _content = "";
  private _numColumns = 50;
  private _abort: AbortController | undefined;

  constructor(private readonly _context: ExtensionContext) { }

  /** Show the panel beside the active editor, without taking focus. */
  reveal() {
    if (this._panel) {
      this._panel.reveal(ViewColumn.Beside, true);
      return;
    }
    const panel = window.createWebviewPanel(ProofStepView.viewType, "Proof Step",
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [this._context.extensionUri] });
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage(async (msg: EditorMessages.Incoming) => await this.onMessage(msg));
    panel.onDidDispose(() => {
      this._abort?.abort();
      this._panel = undefined;
    });
    this._panel = panel;
    if (!this._state)
      this._content = "<div class='goal-description'>Waiting for the proof debugger to start…</div>";
  }

  /** Show `state`, if the panel is open. */
  update(state: StepState) {
    this._state = state;
    void this.render();
  }

  dispose() {
    this._panel?.dispose();
  }

  private async render() {
    if (!this._panel || !this._state)
      return;
    this._abort?.abort();
    this._abort = new AbortController();
    const signal = this._abort.signal;
    try {
      const content = await this.toHtml(this._state, signal);
      signal.throwIfAborted();
      this._content = content;
      await this._panel?.webview.postMessage({ type: "update", body: { content } } as EditorMessages.Outgoing);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        console.log(`Error rendering proof step: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async toHtml(state: StepState, signal: AbortSignal): Promise<string> {
    const { goal, step } = state;
    const sr = step.result;
    const gsc = new GSC.Converter(GSC.Options.from_config(this._numColumns, getExtensionConfig()), signal);
    const ctx = { goal };

    const title = `<div class='goal-info'><div class='goal-title'>${jumpLink(goal.name, goal.location)}</div></div>`;

    // At the end, show the proof as a whole: its original goal and its outcome.
    let description, subgoal, subgoals, failure;
    if (state.finished) {
      description = "End of proof";
      subgoal = state.initialGoal;
      subgoals = (goal.subgoals ?? []);
      failure = (goal.errors ?? []).length > 0 ? await gsc.errors2html(goal.errors) : undefined;
    } else {
      const details = [`Step ${step.index + 1} of ${state.total}`];
      if (step.applications > 1)
        details.push(`application ${step.application + 1} of ${step.applications}`);
      details.push(PS.outcome(sr));
      description = details.join(" · ");
      subgoal = sr.goal;
      subgoals = sr.subgoals ?? [];
      failure = PS.isFailure(sr) ? `<div class='code-like'>${escapeHtml(sr.error!).replaceAll("\n", "<br/>")}</div>` : undefined;
    }

    let content = `<div class='goal-debug-progress'>${escapeHtml(description)}</div>`;
    content += section("Subgoal", subgoal ? await gsc.sequent2html(subgoal, ctx) : "<div class='goal-description'>unknown</div>");

    let result;
    if (failure)
      result = failure;
    else if (subgoals.length == 0)
      result = "<div class='code-like'>&#x25A0</div>";
    else
      result = await gsc.subgoals2html(subgoals, ctx);
    content += section(subgoals.length > 1 ? `Result (${subgoals.length})` : "Result", result);

    return `<div class='goal'>${title}<div class='goal-content'>${content}</div></div>`;
  }

  private async onMessage(msg: EditorMessages.Incoming) {
    switch (msg.command) {
      case "ready":
        await this._panel?.webview.postMessage({ type: "init", body: { value: this._content, editable: false } } as EditorMessages.Outgoing);
        void this.render();
        break;
      case "resize": {
        // Same as for the goal state.
        const columns = Math.max(Math.trunc(2.0 * (msg.arguments.width * 0.75) / msg.arguments.font_size), 10);
        if (columns != this._numColumns) {
          this._numColumns = columns;
          void this.render();
        }
        break;
      }
      case "jump-to":
        await jumpTo(msg.arguments.uri, msg.arguments.options, msg.arguments.location);
        break;
      case "jump-to-declaration":
        await jumpToDeclaration(msg.arguments.name);
        break;
    }
  }

  private html(webview: Webview): string {
    const media = (...p: string[]) => webview.asWebviewUri(Uri.joinPath(this._context.extensionUri, ...p)).toString();
    const nonce = getNonce();

    return /* html */`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${media("media", "reset.css")}" rel="stylesheet" />
        <link href="${media("media", "vscode.css")}" rel="stylesheet" />
        <link href="${media("out", "codicon.css")}" rel="stylesheet" />
        <link href="${media("media", "goal_state.css")}" rel="stylesheet" />

        <svg xmlns="http://www.w3.org/2000/svg" class='invisible'>
          <defs>
            <g id="turnstile-svg">
              <line x1=0 y1=0 x2=0 y2=20 stroke-width=2 />
              <line x1=0 y1=10 x2=60 y2=10 stroke-width=1 />
            </g>
          </defs>
        </svg>

        <title>Proof Step</title>
      </head>
      <body>
        <div class='title'>
          Proof Step
          <img class="logo" src="${media("assets", "imandra-smile.png")}" alt="Logo">
        </div>

        <p>
          <div class="goal-state-content" data-vscode-context='{"webviewSection": "editor", "preventDefaultContextMenuItems": true}'/>
        </p>

        <script nonce="${nonce}" src="${media("media", "goal_state.js")}"/>
      </body>
      </html>`;
  }
}
