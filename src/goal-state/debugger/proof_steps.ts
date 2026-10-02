import * as IX from '../imandrax_types';
import * as TermFormatter from '../term-formatter';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import sanitize = require('sanitize-html');

// The proof debugger replays the subresults of a goal: each subresult is one
// application of a tactic (identified by its sub-anchor) to a goal, with the
// resulting subgoals or an error. `Goal.subresults[i]` holds the applications
// of the i-th tactic, one per goal it was applied to.
//
// When all subresults have source locations, tactics are nested by location
// (e.g. `t1 @> t2` contains `t1` and `t2`) and replayed outer-first, in source
// order; the "call stack" is the chain of enclosing tactics. Otherwise they are
// replayed flat, in the order given.

export interface ProofStep {
  index: number;               // Position in the replay order.
  application: number;         // Position among the applications of the same tactic.
  applications: number;        // Number of applications of the same tactic.
  result: IX.Subresult;
  parent: ProofStep | undefined; // First application of the enclosing tactic.
  depth: number;
  end: number;                 // One past the last step of this tactic and the tactics it encloses.
}

interface Position { line: number, column: number }

function pos(p: { line: bigint, column: bigint }): Position {
  return { line: Number(p.line), column: Number(p.column) };
}

function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line == b.line && a.column <= b.column);
}

function rangeContains(outer: IX.SourceLocation, inner: IX.SourceLocation): boolean {
  return outer.uri === inner.uri &&
    before(pos(outer.from), pos(inner.from)) && before(pos(inner.to), pos(outer.to));
}

interface Tactic {
  results: IX.Subresult[];
  location: IX.SourceLocation;
  anchor: number;
  children: Tactic[];
}

export class ProofSteps {
  readonly steps: ProofStep[] = [];
  /** Whether steps are nested by source location. */
  readonly nested: boolean;

  constructor(readonly goal: IX.Goal) {
    const groups = (goal.subresults ?? []).filter(rs => rs.length > 0);
    this.nested = groups.length > 0 && groups.every(rs => rs[0].location);
    if (!this.nested) {
      for (const results of groups)
        this.add(results, undefined, 0);
      return;
    }

    const tactics: Tactic[] = groups.map(results =>
      ({ results, location: results[0].location!, anchor: Number(results[0].subanchor.anchor), children: [] }));

    // The parent of a tactic is the smallest other tactic whose range contains it.
    // Equal ranges are ordered by anchor; enclosing tactics have larger anchors.
    const encloses = (outer: Tactic, inner: Tactic) =>
      outer !== inner && rangeContains(outer.location, inner.location) &&
      (!rangeContains(inner.location, outer.location) || outer.anchor > inner.anchor);
    const roots: Tactic[] = [];
    for (const t of tactics) {
      const parent = tactics.filter(o => encloses(o, t)).reduce<Tactic | undefined>(
        (best, o) => (!best || encloses(best, o)) ? o : best, undefined);
      (parent?.children ?? roots).push(t);
    }

    const bySource = (a: Tactic, b: Tactic) => {
      const pa = pos(a.location.from), pb = pos(b.location.from);
      return pa.line - pb.line || pa.column - pb.column || b.anchor - a.anchor;
    };
    const visit = (t: Tactic, parent: ProofStep | undefined, depth: number) => {
      const first = this.add(t.results, parent, depth);
      t.children.sort(bySource).forEach(c => visit(c, first, depth + 1));
      for (let i = first.index; i < first.index + t.results.length; i++)
        this.steps[i].end = this.steps.length;
    };
    roots.sort(bySource).forEach(t => visit(t, undefined, 0));
  }

  private add(results: IX.Subresult[], parent: ProofStep | undefined, depth: number): ProofStep {
    const first = this.steps.length;
    results.forEach((result, application) => {
      const index = this.steps.length;
      this.steps.push({ index, application, applications: results.length, result, parent, depth, end: index + 1 });
    });
    return this.steps[first];
  }

  get length(): number { return this.steps.length; }

  /** The chain of enclosing tactics of the step at `index`, outermost first. */
  path(index: number): ProofStep[] {
    const r: ProofStep[] = [];
    for (let s: ProofStep | undefined = this.steps[index]; s; s = s.parent)
      r.unshift(s);
    return r;
  }

  // Navigation. `undefined` means "ran off the end".

  stepIn(index: number): number | undefined {
    return index + 1 < this.length ? index + 1 : undefined;
  }

  /** Skip the tactics enclosed by this one, unless there are more applications of it. */
  next(index: number): number | undefined {
    const s = this.steps[index];
    const to = s.application + 1 < s.applications ? index + 1 : s.end;
    return to < this.length ? to : undefined;
  }

  stepOut(index: number): number | undefined {
    const parent = this.steps[index].parent;
    if (!parent)
      return this.next(index);
    return parent.end < this.length ? parent.end : undefined;
  }

  stepBack(index: number): number {
    return Math.max(index - 1, 0);
  }

  /**
   * The source location of a step's tactic. Tactics are part of the goal's
   * [@@by ...] attribute, so they are in the goal's file; we do not rely on the
   * URI of subresult locations, which may refer to something else (e.g. the
   * goal state document).
   */
  location(step: ProofStep): IX.SourceLocation | undefined {
    const loc = step.result.location;
    const uri = (this.goal.byLocation ?? this.goal.location)?.uri;
    return loc ? { ...loc, uri: uri ?? loc.uri } : undefined;
  }

  /** Steps whose tactic starts on `line` (1-based) of the file at `uri`. */
  stepsAtLine(matchesUri: (uri: string) => boolean, line: number): ProofStep[] {
    return this.steps.filter(s => {
      const loc = this.location(s);
      return loc && matchesUri(loc.uri) && Number(loc.from.line) === line;
    });
  }
}

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

export function anchorName(sr: IX.Subresult): string {
  return `${sr.subanchor.name}#${sr.subanchor.anchor}`;
}

export function isFailure(sr: IX.Subresult): boolean {
  return sr.error !== undefined && sr.error !== null;
}

/** Function breakpoints name a sub-anchor, either as `name#anchor` or just `anchor`. */
export function matchesBreakpoint(sr: IX.Subresult, breakpoint: string): boolean {
  const bp = breakpoint.trim();
  return bp === anchorName(sr) || bp === `${sr.subanchor.anchor}` || bp === `#${sr.subanchor.anchor}`;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type Value =
  | { kind: "text", text: string }
  | { kind: "term", term: IX.Term }
  | { kind: "sequent", sequent: IX.Sequent }
  | { kind: "group", summary: string, fields: Field[] };

export interface Field {
  name: string;
  value: Value;
}

const text = (s: string): Value => ({ kind: "text", text: s });
const term = (t: IX.Term): Value => ({ kind: "term", term: t });
const sequent = (s: IX.Sequent): Value => ({ kind: "sequent", sequent: s });
const group = (summary: string, fields: Field[]): Value => ({ kind: "group", summary, fields });

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case "lt": return "<";
      case "gt": return ">";
      case "amp": return "&";
      case "quot": return "\"";
      case "apos": return "'";
      default: return String.fromCodePoint(e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

/**
 * Turn the HTML produced by the goal state's term formatter into plain text.
 * This needs a real parser: hover attributes contain `>` (e.g. in types like
 * `int -> int`) and nested markup.
 */
export function html2text(html: string): string {
  const text = sanitize(html.replace(/<br\s*\/?>/g, "\n"), { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(text).replaceAll("\t", "  ");
}

export class TextFormatter {
  constructor(private readonly goal: IX.Goal | undefined, private readonly stripModuleScope = false) { }

  term(t: IX.Term, width: number): string {
    return html2text(TermFormatter.prettify(width, t, this.goal, undefined, false, this.stripModuleScope)).trim();
  }

  sequent(s: IX.Sequent, width: number): string {
    return html2text(TermFormatter.prettify_sequent(width, s, this.goal, undefined, undefined, true, this.stripModuleScope)).trim();
  }

  /** Render a value; a very large `width` yields a single line. */
  value(v: Value, width: number): string {
    switch (v.kind) {
      case "text": return v.text;
      case "term": return this.term(v.term, width);
      case "sequent": return this.sequent(v.sequent, width);
      case "group": return v.summary;
    }
  }

  /** Render a value in full, including the members of groups. */
  full(v: Value, width: number): string {
    if (v.kind !== "group")
      return this.value(v, width);
    return v.fields.map(f => `${f.name}:\n${this.full(f.value, width).replace(/^/gm, "  ")}`).join("\n");
  }
}

function plural(n: number, what: string): string {
  return `${n} ${what}${n == 1 ? "" : "s"}`;
}

/** What a tactic application resulted in. */
export function outcome(sr: IX.Subresult): string {
  if (isFailure(sr))
    return "failed";
  const n = (sr.subgoals ?? []).length;
  return n == 0 ? "proved" : plural(n, "subgoal");
}

/** A short, single-line description of a step, used as stack frame name. */
export function stepSummary(step: ProofStep): string {
  const of = step.applications > 1 ? ` (${step.application + 1}/${step.applications})` : "";
  return `${anchorName(step.result)}${of} → ${outcome(step.result)}`;
}

export function stepFields(step: ProofStep): Field[] {
  const sr = step.result;
  const r: Field[] = [
    { name: "anchor", value: text(anchorName(sr)) },
    { name: "outcome", value: text(outcome(sr)) },
  ];
  if (isFailure(sr))
    r.push({ name: "error", value: text(sr.error!) });
  if (step.applications > 1)
    r.push({ name: "application", value: text(`${step.application + 1} of ${step.applications}`) });
  return r;
}

export function sequentFields(s: IX.Sequent): Field[] {
  const name = (n: IX.NamedTerm, prefix: string, i: number, count: number) =>
    n.name ?? (count > 1 ? `${prefix}${i}` : prefix);
  return [
    ...s.hypotheses.map((h, i) => ({ name: name(h, "H", i, s.hypotheses.length), value: term(h.term) })),
    ...s.conclusions.map((c, i) => ({ name: name(c, "C", i, s.conclusions.length), value: term(c.term) })),
  ];
}

/** The goal state's "proved" symbol, `&#x25A0` (■) in state-converter.ts. */
export const qed = "■";

/** The subgoals a tactic application produced; just `qed` if it proved its goal. */
export function subgoalFields(sr: IX.Subresult): Field[] {
  const subgoals = sr.subgoals ?? [];
  // VS Code shows `name = value` unless the value is empty, so to show a
  // bare `qed`, it has to be the name.
  if (subgoals.length == 0 && !isFailure(sr))
    return [{ name: qed, value: text("") }];
  return subgoals.map((s, i) => ({ name: `${i}`, value: sequent(s) }));
}

export function goalStatus(goal: IX.Goal): string {
  const subgoals = goal.subgoals ?? [];
  const status = (goal.errors ?? []).length > 0 ? "failed" : subgoals.length == 0 ? "proved" : `${plural(subgoals.length, "subgoal")} remaining`;
  return goal.outdated ? `${status} (outdated)` : status;
}

/** `current` is the goal the current step works on, if any. */
export function goalFields(goal: IX.Goal, current?: IX.Sequent): Field[] {
  const subgoals = goal.subgoals ?? [];
  const errors = goal.errors ?? [];
  const definitions = goal.definitions ?? [];
  const r: Field[] = [{ name: "name", value: text(goal.name) }];
  if (current)
    r.push({ name: "sequent", value: sequent(current) });
  r.push(
    { name: "status", value: text(goalStatus(goal)) },
    { name: "variables", value: text(goal.vars.join(", ")) },
  );
  if (subgoals.length > 0)
    r.push({
      name: "subgoals", value: group(`${subgoals.length}`, subgoals.map((s, i) =>
        ({ name: `${i}`, value: typeof s === "string" ? text(s) : sequent(s) })))
    });
  if (errors.length > 0)
    r.push({ name: "errors", value: group(`${errors.length}`, errors.map((e, i) => ({ name: `${i}`, value: text(`${e.kind}: ${e.message}`) }))) });
  if (definitions.length > 0)
    r.push({
      name: "definitions", value: group(`${definitions.length}`, definitions.map(d =>
        ({ name: [d.name, ...d.vars].join(" "), value: term(d.body) })))
    });
  return r;
}
