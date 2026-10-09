import { fileURLToPath } from 'url';
import * as path from 'path';

import {
  DebugSession,
  Handles,
  InitializedEvent,
  OutputEvent,
  Scope,
  Source,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

import * as IX from '../imandrax_types';
import * as PS from './proof_steps';

// A debug adapter that steps through the tactic applications (subresults) of a
// goal in the goal state (see proof_steps.ts). It runs inline in the extension host (see
// register.ts), but does not depend on the `vscode` module so that it can be
// tested on its own.

export interface LaunchArguments extends DebugProtocol.LaunchRequestArguments {
  /** Anchor of the goal to debug; filled in by the debug configuration provider. */
  anchor?: string;
  /** Name of the goal to debug. */
  goal?: string;
  /** Path of the file that contains the goal. */
  file?: string;
  /** Stop at the first step (default: true). */
  stopOnEntry?: boolean;
  /** Strip module scopes off of identifiers (default: false). */
  stripModuleScope?: boolean;
}

export type GoalStateLoader = () => Promise<IX.GoalState | undefined>;

/** The state of the debugger at a step, for views in the extension host (see view.ts). */
export interface StepState {
  goal: IX.Goal;
  step: PS.ProofStep;
  /** The enclosing tactics of the step, outermost first, ending with the step. */
  path: PS.ProofStep[];
  /** The source location of the step's tactic, see `ProofSteps.location`. */
  location: IX.SourceLocation | undefined;
  total: number;
  /** The goal the proof starts from: the goal of the first step. */
  initialGoal: IX.Sequent | undefined;
  /** Whether the debugger has run past the last step. */
  finished: boolean;
}

const THREAD_ID = 1;
const GOAL_FRAME_ID = 0; // Frame ids of steps are their index + 1.
const FAILURE_FILTER = "failure";
const CONSOLE_WIDTH = 80;
const FLAT_WIDTH = 1_000_000;

interface Container {
  fields: PS.Field[];
  evaluatePrefix: string;
}

type ScopeDescription = [name: string, fields: PS.Field[], evaluatePrefix: string];

function locationPath(uri: string): string | undefined {
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
}

export function findGoal(state: IX.GoalState, args: LaunchArguments): IX.Goal | undefined {
  const goals = state.goals ?? [];
  const byAnchor = args.anchor !== undefined ? goals.find(g => g.anchor === args.anchor) : undefined;
  if (byAnchor)
    return byAnchor;
  // The anchor may have gone stale after a re-check; fall back to name and file.
  return goals.find(g =>
    (args.goal === undefined || g.name === args.goal) &&
    (args.file === undefined || (g.location !== undefined && locationPath(g.location.uri) === args.file)));
}

export class ProofDebugSession extends DebugSession {
  private _steps: PS.ProofSteps | undefined;
  private _fmt = new PS.TextFormatter(undefined);
  private _position = 0;
  private _finished = false;
  private _launchArgs: LaunchArguments = {};
  private _functionBreakpoints: string[] = [];
  private _lineBreakpoints = new Map<string, number[]>(); // Path -> 1-based lines.
  private _stopOnFailures = false;
  private _containers = new Handles<Container>();
  private _evaluatable = new Map<string, PS.Value>();
  private _configurationDone: Promise<void>;
  private _resolveConfigurationDone!: () => void;

  /** Called whenever the debugger stops at a step or finishes. */
  onDidChangeState: ((state: StepState) => void) | undefined;

  constructor(private readonly _loadGoalState: GoalStateLoader) {
    super();
    // ImandraX source locations are 1-based.
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
    this._configurationDone = new Promise(resolve => { this._resolveConfigurationDone = resolve; });
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {
    response.body = {
      ...response.body,
      supportsConfigurationDoneRequest: true,
      supportsFunctionBreakpoints: true,
      supportsStepBack: true,
      supportsRestartRequest: true,
      supportsClipboardContext: true,
      exceptionBreakpointFilters: [{
        filter: FAILURE_FILTER,
        label: "Tactic failures",
        description: "Stop at tactic applications that failed",
        default: false,
      }],
    };
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
    super.configurationDoneRequest(response, args);
    this._resolveConfigurationDone();
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchArguments): void {
    this._launchArgs = args;
    void this.loadAndStart(response, true);
  }

  protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
    if (args.arguments)
      this._launchArgs = args.arguments as LaunchArguments;
    void this.loadAndStart(response, false);
  }

  private async loadAndStart(response: DebugProtocol.Response, waitForConfiguration: boolean): Promise<void> {
    const error = await this.load();
    if (error) {
      this.sendErrorResponse(response, 1, error);
      return;
    }
    // Wait for the breakpoints before running anywhere.
    if (waitForConfiguration)
      await this._configurationDone;
    this.sendResponse(response);
    this.beginDebug();
  }

  private async load(): Promise<string | undefined> {
    let state;
    try {
      state = await this._loadGoalState();
    } catch (e) {
      return `Could not read the goal state: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!state)
      return "The goal state is not available. Is the ImandraX language server running?";

    const goal = findGoal(state, this._launchArgs);
    if (!goal) {
      const what = this._launchArgs.goal ? `Goal '${this._launchArgs.goal}'` : "The selected goal";
      return `${what} is not in the goal state, please check the goal first.`;
    }

    const steps = new PS.ProofSteps(goal);
    if (steps.length == 0)
      return `There are no tactic steps (subresults) for '${goal.name}'.`;

    this._steps = steps;
    this._fmt = new PS.TextFormatter(goal, this._launchArgs.stripModuleScope ?? false);
    return undefined;
  }

  private beginDebug() {
    if (this._launchArgs.stopOnEntry ?? true)
      this.stopAt(0, "entry");
    else
      this.runForward(0);
  }

  // Execution control

  private stopAt(index: number, reason: string, text?: string) {
    this._position = index;
    this._finished = false;
    this._containers.reset();
    this._evaluatable.clear();
    // Notify first, so that views can reveal the step before VS Code does (see register.ts).
    this.notifyStateChange();
    this.sendEvent(new StoppedEvent(reason, THREAD_ID, text));
  }

  private finish() {
    // All steps have been run.
    this._position = this._steps!.length - 1;
    this._finished = true;
    this.sendEvent(new TerminatedEvent());
    this.notifyStateChange();
  }

  private notifyStateChange() {
    const state = this.stepState();
    if (state)
      this.onDidChangeState?.(state);
  }

  /** The state at the step of stack frame `frameId`, or at the current step. */
  stepState(frameId?: number): StepState | undefined {
    if (!this._steps)
      return undefined;
    const index = frameId === undefined || frameId === GOAL_FRAME_ID ? this._position : frameId - 1;
    const step = this._steps.steps[index];
    if (!step)
      return undefined;
    return {
      goal: this._steps.goal,
      step,
      path: this._steps.path(index),
      location: this._steps.location(step),
      total: this._steps.length,
      initialGoal: this._steps.steps[0]?.result.goal,
      finished: this._finished && index === this._position,
    };
  }

  private hit(index: number): { reason: string, text?: string } | undefined {
    const sr = this._steps!.steps[index].result;
    const loc = this._steps!.location(this._steps!.steps[index]);
    const p = loc ? locationPath(loc.uri) : undefined;
    if (p && this._lineBreakpoints.get(p)?.includes(Number(loc!.from.line)))
      return { reason: "breakpoint" };
    if (this._functionBreakpoints.some(bp => PS.matchesBreakpoint(sr, bp)))
      return { reason: "function breakpoint" };
    if (this._stopOnFailures && PS.isFailure(sr))
      return { reason: "exception", text: sr.error };
    return undefined;
  }

  private runForward(from: number) {
    for (let i = from; i < this._steps!.length; i++) {
      const h = this.hit(i);
      if (h)
        return this.stopAt(i, h.reason, h.text);
    }
    this.finish();
  }

  private runBackward(from: number) {
    for (let i = from; i >= 0; i--) {
      const h = this.hit(i);
      if (h)
        return this.stopAt(i, h.reason, h.text);
    }
    this.stopAt(0, "entry");
  }

  private step(to: number | undefined) {
    if (to === undefined)
      this.finish();
    else
      this.stopAt(to, "step");
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, _args: DebugProtocol.ContinueArguments): void {
    response.body = { allThreadsContinued: true };
    this.sendResponse(response);
    this.runForward(this._position + 1);
  }

  protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, _args: DebugProtocol.ReverseContinueArguments): void {
    this.sendResponse(response);
    this.runBackward(this._position - 1);
  }

  protected nextRequest(response: DebugProtocol.NextResponse, _args: DebugProtocol.NextArguments): void {
    this.sendResponse(response);
    this.step(this._steps!.next(this._position));
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, _args: DebugProtocol.StepInArguments): void {
    this.sendResponse(response);
    this.step(this._steps!.stepIn(this._position));
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, _args: DebugProtocol.StepOutArguments): void {
    this.sendResponse(response);
    this.step(this._steps!.stepOut(this._position));
  }

  protected stepBackRequest(response: DebugProtocol.StepBackResponse, _args: DebugProtocol.StepBackArguments): void {
    this.sendResponse(response);
    this.step(this._steps!.stepBack(this._position));
  }

  // Breakpoints

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
    const p = args.source.path ? this.convertClientPathToDebugger(args.source.path) : undefined;
    const lines = (args.breakpoints ?? []).map(bp => this.convertClientLineToDebugger(bp.line));
    if (p)
      this._lineBreakpoints.set(p, lines);
    response.body = {
      breakpoints: lines.map(line => {
        const matches = p ? this._steps?.stepsAtLine(uri => locationPath(uri) === p, line).length : 0;
        return {
          verified: matches === undefined || matches > 0,
          line: this.convertDebuggerLineToClient(line),
          message: matches === 0 ? "No tactic of this proof starts on this line" : undefined,
        };
      })
    };
    this.sendResponse(response);
  }

  protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
    this._functionBreakpoints = args.breakpoints.map(bp => bp.name);
    response.body = {
      breakpoints: args.breakpoints.map(bp => {
        const matches = this._steps?.steps.filter(s => PS.matchesBreakpoint(s.result, bp.name)).length;
        return {
          verified: matches === undefined || matches > 0,
          message: matches === 0 ? `No tactic application matches '${bp.name}'` : undefined,
        };
      })
    };
    this.sendResponse(response);
  }

  protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
    this._stopOnFailures = args.filters.includes(FAILURE_FILTER);
    this.sendResponse(response);
  }

  // State inspection

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new Thread(THREAD_ID, this._steps?.goal.name ?? "proof")] };
    this.sendResponse(response);
  }

  /** A stack frame at `loc`, or at the goal's [@@by ...] attribute or the goal itself. */
  private frame(id: number, name: string, loc: IX.SourceLocation | undefined): StackFrame {
    const goal = this._steps!.goal;
    loc ??= goal.byLocation ?? goal.location;
    const p = loc ? locationPath(loc.uri) : undefined;
    if (!loc || !p)
      return new StackFrame(id, name);
    const f = new StackFrame(id, name, new Source(path.basename(p), this.convertDebuggerPathToClient(p)),
      this.convertDebuggerLineToClient(Number(loc.from.line)), this.convertDebuggerColumnToClient(Number(loc.from.column)));
    // Locations are inclusive, DAP end columns are exclusive.
    f.endLine = this.convertDebuggerLineToClient(Number(loc.to.line));
    f.endColumn = this.convertDebuggerColumnToClient(Number(loc.to.column) + 1);
    return f;
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, _args: DebugProtocol.StackTraceArguments): void {
    const steps = this._steps!;
    const frames = steps.path(this._position).reverse().map(s =>
      this.frame(s.index + 1, PS.stepSummary(s), steps.location(s)));
    frames.push(this.frame(GOAL_FRAME_ID, `Goal ${steps.goal.name}`, steps.goal.location));
    response.body = { stackFrames: frames, totalFrames: frames.length };
    this.sendResponse(response);
  }

  private frameScopes(frameId: number): ScopeDescription[] {
    const steps = this._steps!;
    // The goal frame shows the goal as of the current step.
    const step = steps.steps[frameId === GOAL_FRAME_ID ? this._position : frameId - 1];
    const sr = step.result;
    const goal: ScopeDescription = ["Goal", PS.goalFields(steps.goal, sr.goal), "goal."];
    if (frameId === GOAL_FRAME_ID)
      return [goal];
    // VS Code only expands the first scope automatically, so the subgoal the
    // tactic works on goes first; the Step details are also in the frame name.
    const r: ScopeDescription[] = [];
    if (sr.goal)
      r.push(["Subgoal", PS.sequentFields(sr.goal), "subgoal."]);
    const result = PS.subgoalFields(sr);
    if (result.length > 0)
      r.push(["Result", result, "result."]);
    r.push(["Step", PS.stepFields(step), ""], goal);
    return r;
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
    response.body = {
      scopes: this.frameScopes(args.frameId).map(([name, fields, evaluatePrefix]) =>
        new Scope(name, this._containers.create({ fields, evaluatePrefix }), false))
    };
    this.sendResponse(response);
  }

  private children(v: PS.Value): PS.Field[] | undefined {
    switch (v.kind) {
      case "group": return v.fields;
      case "sequent": return PS.sequentFields(v.sequent);
      default: return undefined;
    }
  }

  protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
    const container: Container | undefined = this._containers.get(args.variablesReference);
    response.body = {
      variables: (container?.fields ?? []).map(f => {
        const evaluateName = (container?.evaluatePrefix ?? "") + f.name;
        this._evaluatable.set(evaluateName, f.value);
        const children = this.children(f.value);
        return {
          name: f.name,
          value: this._fmt.value(f.value, FLAT_WIDTH).replace(/\s*\n\s*/g, " "),
          evaluateName,
          variablesReference: children ? this._containers.create({ fields: children, evaluatePrefix: evaluateName + "." }) : 0,
        };
      })
    };
    this.sendResponse(response);
  }

  private lookup(expression: string, frameId: number | undefined): PS.Value | undefined {
    const e = expression.trim();
    const known = this._evaluatable.get(e);
    if (known)
      return known;
    for (const [_, fields, prefix] of this.frameScopes(frameId ?? this._position + 1)) {
      const f = fields.find(f => prefix + f.name === e || f.name === e);
      if (f)
        return f.value;
    }
    return undefined;
  }

  protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
    if (!this._steps) {
      this.sendErrorResponse(response, 2, "No proof is being debugged.");
      return;
    }
    const v = this.lookup(args.expression, args.frameId);
    if (!v) {
      const names = this.frameScopes(args.frameId ?? this._position + 1).flatMap(([_, fs, prefix]) => fs.map(f => prefix + f.name));
      this.sendErrorResponse(response, 3, `Unknown name '${args.expression}'. Available: ${names.join(", ")}`);
      return;
    }
    const children = this.children(v);
    response.body = {
      result: this._fmt.full(v, CONSOLE_WIDTH),
      variablesReference: children && args.context !== "clipboard" ? this._containers.create({ fields: children, evaluatePrefix: args.expression.trim() + "." }) : 0,
    };
    this.sendResponse(response);
  }

  private output(text: string) {
    this.sendEvent(new OutputEvent(text, "console"));
  }
}
