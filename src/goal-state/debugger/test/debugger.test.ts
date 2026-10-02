import { beforeEach, describe, expect, test } from '@jest/globals';

import * as fs from 'fs';
import { fileURLToPath } from 'url';

import { DebugProtocol } from '@vscode/debugprotocol';

import * as IX from "../../imandrax_types"
import * as PS from "../proof_steps";
import { ProofDebugSession, LaunchArguments, StepState } from "../session";

const fixture = JSON.parse(fs.readFileSync('src/goal-state/test/some-state.json', 'utf-8')) as IX.GoalState;
const byName = (name: string) => fixture.goals.find(g => g.name === name && (g.subresults ?? []).length > 0)!;

// thm11 has three successful tactic applications (#2, #3, #5); thm4 has one
// failed one. Combine them so that one goal has both.
const thm11 = byName("thm11");
const thm4 = byName("thm4");
const goal: IX.Goal = { ...thm11, anchor: "a1", subresults: [...thm11.subresults, ...thm4.subresults] };
const thm1 = fixture.goals.find(g => g.name === "thm1")!; // No subresults.

// The same, with source locations: `thm11#5` is `#2 @> #3`, and `thm4#2` is
// on a later line.
const uri = goal.location!.uri;
const loc = (line: number, from: number, to: number): IX.SourceLocation =>
  ({ uri, from: { line: BigInt(line), column: BigInt(from) }, to: { line: BigInt(line), column: BigInt(to) } });
const located: [number, IX.SourceLocation][] = [[2, loc(63, 7, 20)], [3, loc(63, 24, 37)], [5, loc(63, 7, 37)]];
const nestedGoal: IX.Goal = {
  ...goal, anchor: "a2",
  subresults: [
    ...thm11.subresults.map(rs => rs.map(sr => ({ ...sr, location: located.find(([a]) => a === Number(sr.subanchor.anchor))![1] }))),
    ...thm4.subresults.map(rs => rs.map(sr => ({ ...sr, location: loc(70, 1, 10) }))),
  ]
};

// The same, but with subresult locations that refer to the goal state document.
const vfsGoal: IX.Goal = {
  ...nestedGoal, anchor: "a3",
  subresults: nestedGoal.subresults.map(rs => rs.map(sr => ({ ...sr, location: { ...sr.location!, uri: "imandrax-vfs://internal//goal-state.ixgs" } }))),
};

const state: IX.GoalState = { format_version: 1, goals: [goal, thm1, nestedGoal, vfsGoal] };

describe("ProofSteps", () => {
  const steps = new PS.ProofSteps(goal);

  test("flattens the subresults", () => {
    expect(steps.length).toBe(4);
    expect(steps.steps.map(s => PS.anchorName(s.result))).toEqual(["thm11#2", "thm11#3", "thm11#5", "thm4#2"]);
  });

  test("summarizes steps", () => {
    expect(PS.stepSummary(steps.steps[0])).toBe("thm11#2 → 1 subgoal");
    expect(PS.stepSummary(steps.steps[3])).toBe("thm4#2 → failed");
    expect(PS.isFailure(steps.steps[3].result)).toBe(true);
    expect(PS.isFailure(steps.steps[0].result)).toBe(false);
  });

  test("shows qed after a step that proved its goal", () => {
    const sr = steps.steps[0].result;
    const proved: IX.Subresult = { ...sr, subgoals: [] };
    expect(PS.subgoalFields(proved)).toEqual([{ name: "■", value: { kind: "text", text: "" } }]);
    // Not for failures, which also have no subgoals.
    expect(PS.subgoalFields({ ...proved, error: "Goal is counter-satisfiable." })).toEqual([]);
    expect(PS.subgoalFields(sr).map(f => f.value.kind)).toEqual(["sequent"]);
  });

  test("matches breakpoints by sub-anchor", () => {
    const sr = steps.steps[1].result;
    expect(PS.matchesBreakpoint(sr, "thm11#3")).toBe(true);
    expect(PS.matchesBreakpoint(sr, "3")).toBe(true);
    expect(PS.matchesBreakpoint(sr, "#3")).toBe(true);
    expect(PS.matchesBreakpoint(sr, "2")).toBe(false);
  });

  test("removes all markup, including hover attributes", () => {
    // Hover attributes contain `>` (in types like `int -> int`) and nested markup.
    for (const f of ['some-state.json', 'tooslow.json']) {
      const st = JSON.parse(fs.readFileSync(`src/goal-state/test/${f}`, 'utf-8')) as IX.GoalState;
      for (const g of st.goals) {
        const fmt = new PS.TextFormatter(g);
        const sequents = [
          ...g.subgoals.filter((s): s is IX.Sequent => typeof s !== "string"),
          ...(g.subresults ?? []).flat().flatMap(sr => [sr.goal, ...sr.subgoals]).filter((s): s is IX.Sequent => !!s),
        ];
        for (const s of sequents)
          for (const width of [80, 1_000_000])
            expect(fmt.sequent(s, width)).not.toMatch(/<\/?[a-z]|'>|data-hover|class=|&(#\w+|lt|gt|amp|quot);/);
      }
    }
    expect(PS.html2text("<span class='hoverable' data-hover='<span class=&#39;type&#39;>int -&gt; int</span>'>f</span> x &lt; y")).toBe("f x < y");
  });

  test("formats terms as plain text", () => {
    const s = new PS.TextFormatter(goal).sequent(steps.steps[0].result.goal!, 80);
    expect(s).not.toMatch(/<|&#/);
    expect(s).toContain("⊢");
    expect(s).toContain("fold_left");
  });
});

describe("ProofSteps with locations", () => {
  const steps = new PS.ProofSteps(nestedGoal);

  test("nests tactics by location, outer first, in source order", () => {
    expect(steps.nested).toBe(true);
    expect(steps.steps.map(s => PS.anchorName(s.result))).toEqual(["thm11#5", "thm11#2", "thm11#3", "thm4#2"]);
    expect(steps.steps.map(s => s.depth)).toEqual([0, 1, 1, 0]);
    expect(steps.path(2).map(s => s.index)).toEqual([0, 2]);
  });

  test("navigates", () => {
    expect(steps.stepIn(0)).toBe(1);
    expect(steps.next(0)).toBe(3);
    expect(steps.next(1)).toBe(2);
    expect(steps.stepOut(1)).toBe(3);
    expect(steps.next(3)).toBeUndefined();
  });

  test("is flat without locations", () => {
    expect(new PS.ProofSteps(goal).nested).toBe(false);
  });
});

// Drives a session through the DAP messages VS Code would send.
class Client {
  private seq = 1;
  readonly events: DebugProtocol.Event[] = [];
  private readonly pending = new Map<number, (r: DebugProtocol.Response) => void>();
  private readonly waiters: [string, (e: DebugProtocol.Event) => void][] = [];

  constructor(readonly session: ProofDebugSession) {
    session.onDidSendMessage(m => {
      const msg = m as DebugProtocol.ProtocolMessage;
      if (msg.type === "response") {
        const r = msg as DebugProtocol.Response;
        this.pending.get(r.request_seq)?.(r);
      } else if (msg.type === "event") {
        const e = msg as DebugProtocol.Event;
        this.events.push(e);
        const i = this.waiters.findIndex(([name]) => name === e.event);
        if (i >= 0)
          this.waiters.splice(i, 1)[0][1](e);
      }
    });
  }

  request<T extends DebugProtocol.Response>(command: string, args?: object): Promise<T> {
    const seq = this.seq++;
    const r = new Promise<T>(resolve => this.pending.set(seq, r => resolve(r as T)));
    this.session.handleMessage({ seq, type: "request", command, arguments: args } as DebugProtocol.Request);
    return r;
  }

  nextEvent(name: string): Promise<DebugProtocol.Event> {
    return new Promise(resolve => this.waiters.push([name, resolve]));
  }

  async topFrame(): Promise<string> {
    const st = await this.request<DebugProtocol.StackTraceResponse>("stackTrace", { threadId: 1 });
    return st.body.stackFrames[0].name;
  }

  async stoppedAfter(command: string): Promise<{ reason: string, top: string }> {
    const stopped = this.nextEvent("stopped");
    await this.request(command, { threadId: 1 });
    const e = await stopped as DebugProtocol.StoppedEvent;
    return { reason: e.body.reason, top: await this.topFrame() };
  }

  async launch(args: LaunchArguments, functionBreakpoints: string[] = [], filters: string[] = []) {
    await this.request("initialize", { adapterID: "imandrax" });
    const launched = this.request("launch", args);
    await this.request("setFunctionBreakpoints", { breakpoints: functionBreakpoints.map(name => ({ name })) });
    await this.request("setExceptionBreakpoints", { filters });
    await this.request("configurationDone");
    return launched;
  }

  async variables(variablesReference: number): Promise<DebugProtocol.Variable[]> {
    return (await this.request<DebugProtocol.VariablesResponse>("variables", { variablesReference })).body.variables;
  }

  async evaluate(expression: string): Promise<DebugProtocol.EvaluateResponse> {
    return this.request<DebugProtocol.EvaluateResponse>("evaluate", { expression, context: "repl" });
  }
}

describe("ProofDebugSession", () => {
  let client: Client;
  beforeEach(() => { client = new Client(new ProofDebugSession(() => Promise.resolve(state))); });

  test("stops on entry and steps", async () => {
    const stopped = client.nextEvent("stopped");
    const r = await client.launch({ anchor: "a1" });
    expect(r.success).toBe(true);
    expect((await stopped as DebugProtocol.StoppedEvent).body.reason).toBe("entry");

    const st = await client.request<DebugProtocol.StackTraceResponse>("stackTrace", { threadId: 1 });
    expect(st.body.stackFrames.map(f => f.name)).toEqual(["thm11#2 → 1 subgoal", "Goal thm11"]);
    // Frames point at the [@@by ...] attribute.
    expect(st.body.stackFrames[0].line).toBe(Number(goal.byLocation!.from.line));

    expect(await client.stoppedAfter("next")).toEqual({ reason: "step", top: "thm11#3 → 1 subgoal" });
    expect(await client.stoppedAfter("stepIn")).toEqual({ reason: "step", top: "thm11#5 → 1 subgoal" });
    expect(await client.stoppedAfter("stepBack")).toEqual({ reason: "step", top: "thm11#3 → 1 subgoal" });

    const states: StepState[] = [];
    client.session.onDidChangeState = s => states.push(s);
    const terminated = client.nextEvent("terminated");
    await client.request("continue", { threadId: 1 });
    await terminated;
    expect(states.map(s => [PS.anchorName(s.step.result), s.finished])).toEqual([["thm4#2", true]]);
    expect(states[0].initialGoal).toBe(goal.subresults[0][0].goal);
  });

  test("reports the state of a stack frame", async () => {
    const stopped = client.nextEvent("stopped");
    await client.launch({ anchor: "a2" });
    await stopped;
    await client.stoppedAfter("stepIn");

    const current = client.session.stepState()!;
    expect(PS.anchorName(current.step.result)).toBe("thm11#2");
    expect(current.path.map(s => PS.anchorName(s.result))).toEqual(["thm11#5", "thm11#2"]);
    expect(current.finished).toBe(false);
    // Frame 1 is the enclosing tactic; frame 0 is the goal, which shows the current step.
    expect(PS.anchorName(client.session.stepState(1)!.step.result)).toBe("thm11#5");
    expect(client.session.stepState(0)!.step).toBe(current.step);
  });

  test("stops at function breakpoints and failures", async () => {
    const stopped = client.nextEvent("stopped");
    await client.launch({ anchor: "a1", stopOnEntry: false }, ["thm11#3"], ["failure"]);
    expect((await stopped as DebugProtocol.StoppedEvent).body.reason).toBe("function breakpoint");
    expect(await client.topFrame()).toBe("thm11#3 → 1 subgoal");

    expect(await client.stoppedAfter("continue")).toEqual({ reason: "exception", top: "thm4#2 → failed" });
    expect(await client.stoppedAfter("reverseContinue")).toEqual({ reason: "function breakpoint", top: "thm11#3 → 1 subgoal" });
  });

  test("shows subgoal, result, step and goal scopes", async () => {
    const stopped = client.nextEvent("stopped");
    await client.launch({ goal: "thm11" });
    await stopped;

    const scopes = await client.request<DebugProtocol.ScopesResponse>("scopes", { frameId: 1 });
    expect(scopes.body.scopes.map(s => s.name)).toEqual(["Subgoal", "Result", "Step", "Goal"]);
    const [subgoal, result, step, goalScope] = scopes.body.scopes.map(s => s.variablesReference);

    expect((await client.variables(step)).map(v => [v.name, v.value])).toEqual([["anchor", "thm11#2"], ["outcome", "1 subgoal"]]);
    expect((await client.variables(subgoal)).map(v => v.name)).toEqual(["C"]);
    const subgoals = await client.variables(result);
    expect(subgoals.map(v => v.name)).toEqual(["0"]);
    expect(subgoals[0].value).toContain("⊢");
    expect(subgoals[0].variablesReference).toBeGreaterThan(0);

    // The goal's sequent is the goal the current step works on.
    const goalVars = await client.variables(goalScope);
    expect(goalVars.map(v => v.name).slice(0, 2)).toEqual(["name", "sequent"]);
    const fmt = new PS.TextFormatter(goal);
    const sequentEv = await client.evaluate("goal.sequent");
    expect(sequentEv.body.result).toBe(fmt.sequent(goal.subresults[0][0].goal!, 80));

    expect((await client.evaluate("result.0")).body.result).toBe(fmt.sequent(goal.subresults[0][0].subgoals[0], 80));
    expect((await client.evaluate("nope")).success).toBe(false);
  });

  test("shows the error of a failed step", async () => {
    const stopped = client.nextEvent("stopped");
    await client.launch({ anchor: "a1", stopOnEntry: false }, [], ["failure"]);
    expect((await stopped as DebugProtocol.StoppedEvent).body).toMatchObject({ reason: "exception", text: "Goal is counter-satisfiable." });
    expect((await client.evaluate("error")).body.result).toBe("Goal is counter-satisfiable.");
  });

  test("nests frames by location and highlights the tactic", async () => {
    const stopped = client.nextEvent("stopped");
    await client.launch({ anchor: "a2" });
    await stopped;
    expect(await client.stoppedAfter("stepIn")).toEqual({ reason: "step", top: "thm11#2 → 1 subgoal" });

    const st = await client.request<DebugProtocol.StackTraceResponse>("stackTrace", { threadId: 1 });
    expect(st.body.stackFrames.map(f => f.name)).toEqual(["thm11#2 → 1 subgoal", "thm11#5 → 1 subgoal", "Goal thm11"]);
    expect(st.body.stackFrames[0]).toMatchObject({ line: 63, column: 7, endLine: 63, endColumn: 21 });

    expect(await client.stoppedAfter("stepOut")).toEqual({ reason: "step", top: "thm4#2 → failed" });
  });

  test("locates tactics in the goal's file, whatever the subresult URI", async () => {
    const stopped = client.nextEvent("stopped");
    await client.launch({ anchor: "a3" });
    await stopped;
    await client.stoppedAfter("stepIn");
    expect(await client.stoppedAfter("stepIn")).toMatchObject({ top: "thm11#3 → 1 subgoal" });
    const st = await client.request<DebugProtocol.StackTraceResponse>("stackTrace", { threadId: 1 });
    expect(st.body.stackFrames[0]).toMatchObject({ line: 63, column: 24, source: { path: fileURLToPath(uri) } });
    expect(client.session.stepState()!.location!.uri).toBe(uri);
  });

  test("stops at line breakpoints", async () => {
    const path = fileURLToPath(uri);
    await client.request("initialize", { adapterID: "imandrax" });
    const stopped = client.nextEvent("stopped");
    const launched = client.request("launch", { anchor: "a2", stopOnEntry: false });
    await new Promise(resolve => setTimeout(resolve, 0)); // Let the goal state load.
    const bps = await client.request<DebugProtocol.SetBreakpointsResponse>("setBreakpoints",
      { source: { path }, breakpoints: [{ line: 70 }, { line: 1 }] });
    expect(bps.body.breakpoints.map(b => b.verified)).toEqual([true, false]);
    await client.request("configurationDone");
    await launched;
    expect((await stopped as DebugProtocol.StoppedEvent).body.reason).toBe("breakpoint");
    expect(await client.topFrame()).toBe("thm4#2 → failed");
  });

  test("fails to launch for goals without subresults", async () => {
    const r = await client.launch({ goal: "thm1" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("no tactic steps");
  });

  test("fails to launch for an unknown goal", async () => {
    const r = await client.launch({ goal: "nope" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("not in the goal state");
  });
});
