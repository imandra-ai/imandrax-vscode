// Readable text for task results and proof reports from the imandrax-api client, for read-only IML documents.
// Only types are imported from 'imandrax-api': the client itself is loaded lazily elsewhere.
import type { ProofObligationResult } from 'imandrax-api';
import type { Model, Sequent, Term } from 'imandrax-api/dist/mir';
import type { ProofTerm } from 'imandrax-api/dist/proof';
import type { AtomicEvent, Expansion, Report, RichText } from 'imandrax-api/dist/report';
import type { DecompositionTaskResult, ProofObligation, ProofObligationTaskResult } from 'imandrax-api/dist/tasks';
import type { MirRenderer } from './mir_format';
import { noHashes } from './mir_printer';

const MAX_PROOF_LINES = 80;

export const secs = (s: number) => (s < 1 ? `${(s * 1000).toFixed(1)} ms` : `${s.toFixed(2)} s`);
// An IML comment; nested comment brackets in `s` would end it early
export const comment = (s: string) => `(* ${s.replace(/\*\)/g, '* )').replace(/\(\*/g, '( *').replace(/\n/g, '\n   ')} *)`;

export function sequentText(s: Sequent, mir: MirRenderer): string {
  const hyps = s.hypotheses.map(h => mir.term(h.term));
  const concl = s.conclusions.map(c => mir.term(c.term)).join(' || ') || 'false';
  return hyps.length ? `${hyps.join(', ')} ⊢ ${concl}` : `⊢ ${concl}`;
}

export const modelLines = (m: Model, mir: MirRenderer): string[] => [
  ...[...m.constants].map(([s, v]) => `let ${s.id.shortName} = ${mir.term(v)}`),
  ...(m.functions.size ? [`functions interpreted: ${[...m.functions.keys()].map(s => s.id.shortName).join(', ')}`] : []),
];

// The termination measure as the SMT solver expanded it (first expansion per function), e.g. `measure#0 xs = if ...`
export function measureExpansions(es: readonly Expansion[], mir: MirRenderer): string[] {
  const out = new Map<string, string>();
  for (const e of es) {
    if (e.function.shortName.startsWith('measure') && !out.has(e.function.fullName)) out.set(e.function.fullName, `${mir.term(e.lhs)} = ${mir.term(e.rhs)}`.replace(/\s*\n\s*/g, ' '));
  }
  return [...out.values()];
}

function richText(r: RichText, mir: MirRenderer): string {
  const parts = r.items.map((i): string => {
    switch (i.kind) {
      case 'plain': case 'bold': case 'italic': return i.text;
      case 'newline': return '\n';
      case 'nested': return richText(i.text, mir);
      case 'list': return i.items.map(x => `\n- ${richText(x, mir)}`).join('');
      case 'uid': return i.uid.shortName;
      case 'term': return mir.term(i.term);
      case 'sequent': return sequentText(i.sequent, mir);
      case 'substitution': return i.substitution.map(s => `${mir.term(s.from)} := ${mir.term(s.to)}`).join(', ');
      default: return noHashes(String(i)); // a kind newer than this client
    }
  });
  // Items carry no separators: "Goal:" then a term
  return parts.reduce((a, p) => (a && p && !/\s$/.test(a) && !/^[\s.,;:)]/.test(p) ? `${a} ${p}` : a + p), '');
}

// One event: a headline, then details
function eventLines(ev: AtomicEvent, mir: MirRenderer): string[] {
  const t = (x: Term) => mir.term(x);
  switch (ev.kind) {
    case 'message': return richText(ev.text, mir).split('\n');
    case 'title': return [`== ${ev.text} ==`];
    case 'enterTactic': return [`tactic ${ev.tactic}`];
    case 'enterWaterfall':
      return [`waterfall${ev.variables.length ? ` for all ${ev.variables.map(v => v.id.shortName).join(' ')}` : ''}: ${t(ev.goal)}`];
    case 'attackSubgoal': return [`subgoal ${ev.name}: ${sequentText(ev.goal, mir)}`];
    case 'waterfallCheckpoint': return [`checkpoint, ${ev.goals.length} goal(s)`, ...ev.goals.map(g => sequentText(g, mir))];
    case 'inductionScheme': return [`induction scheme: ${t(ev.scheme)}`];
    case 'rewriteSuccess': return [`rewrite with ${ev.rule.name.shortName}: ${t(ev.term)}  ~>  ${t(ev.result)}`];
    case 'rewriteFail': return [`rewrite with ${ev.rule.name.shortName} failed on ${t(ev.term)}: ${ev.reason}`];
    case 'instantiationSuccess': return [`instantiate ${ev.rule.function.name.shortName}: ${t(ev.term)}`];
    case 'simplifyTerm': return [`simplify ${t(ev.term)}  ~>  ${t(ev.result)}`];
    case 'simplifyClause':
      return [`simplify clause ${t(ev.clause)}  ~>  ${ev.result.length ? ev.result.map(t).join(' ; ') : '(no clauses)'}`];
    case 'functionExpansion': return [`expand ${t(ev.term)}  ~>  ${t(ev.expansion)}`];
    case 'refutedBySmt': return ['refuted by SMT', ...(ev.model ? modelLines(ev.model, mir) : [])];
    case 'provedBySmt': {
      const p = ev.proof;
      const named = (xs: readonly string[]) => [...new Set(xs)].join(', ');
      return [
        `proved by SMT (${[...p.logic].join(', ')})`,
        `goal: ${t(ev.goal)}`,
        ...(p.unsatCore.length ? [`unsat core: ${p.unsatCore.map(t).join(' ; ')}`] : []),
        ...(p.expansions.length ? [`expanded: ${named(p.expansions.map(e => e.function.shortName))}`] : []),
        ...measureExpansions(p.expansions, mir).map(m => `measure: ${m}`),
        ...(p.instantiations.length ? [`instantiated: ${named(p.instantiations.map(i => i.fromRule.shortName))}`] : []),
      ];
    }
    default: return [noHashes(String(ev))];
  }
}

// Events indented by span (tactics, waterfalls, SMT calls), spans with their durations
export function reportLines(report: Report, mir: MirRenderer): string[] {
  const out: string[] = [];
  const open: { line: number; start: number }[] = [];
  for (const e of report.events) {
    if (e.kind === 'exitSpan') {
      const s = open.pop();
      if (s) { out[s.line] += `  [${secs(e.timestamp - s.start)}]`; }
      continue;
    }
    const pad = '  '.repeat(open.length);
    const [head, ...more] = eventLines(e.event, mir);
    if (e.kind === 'enterSpan') { open.push({ line: out.length, start: e.timestamp }); }
    out.push(`${pad}${e.kind === 'enterSpan' ? '▸ ' : ''}${head}`, ...more.map(l => `${pad}    ${l}`));
  }
  return out;
}

// The proof tree: each step's rule and conclusion
export function proofLines(p: ProofTerm, mir: MirRenderer): string[] {
  const out: string[] = [];
  const go = (q: ProofTerm, pad: string, premise = '') => {
    if (out.length > MAX_PROOF_LINES) { return; }
    out.push(`${pad}${premise}${q.kind === 'rule' ? q.rule : q.kind}: ${sequentText(q.conclusion, mir)}`);
    if (q.kind === 'subst') { go(q.premise, `${pad}  `); }
    if (q.kind === 'deduction') { for (const pr of q.premises) { for (const x of pr.proofs) { go(x, `${pad}  `, pr.name ? `${pr.name}: ` : ''); } } }
  };
  go(p, '');
  return out.length > MAX_PROOF_LINES ? [...out.slice(0, MAX_PROOF_LINES), '…'] : out;
}

const OTHER: Record<string, string> = { unknown: 'unknown', err: 'error', verifiedUpto: 'verified up to bound', testOk: 'test passed' };

// A check's PO verdict, as its diagnostic tells it
export function outcome(r: ProofObligationResult): string {
  if (r.proved) { return 'proved'; }
  if (r.found) { return (r.model ? r.model.kind === 'counterExample' : r.errors.length > 0) ? 'refuted' : 'instance found'; }
  return OTHER[r.outcome ?? ''] ?? 'no result';
}

const statsText = (s: ProofObligationTaskResult['statistics']) =>
  [secs(s.timeS), ...(s.tactic ?? []).map(t => `${t.name} ${t.value}`)].join(', ');

// A PO's verdict and goal, its counterexample or instance, the proof and the report
// A section's text, or a note in its place: one unexpected shape loses that section, not the document
const section = (mir: MirRenderer, title: string, f: () => string) => {
  try { return f(); } catch (e) { return mir.note(`${title}: could not print (${e instanceof Error ? e.message : String(e)})`); }
};
const reportSection = (report: Report, mir: MirRenderer) =>
  section(mir, 'Report', () => mir.note(`Report\n${reportLines(report, mir).join('\n') || '(no events)'}`));

export function poDocument(r: ProofObligationResult, po: ProofObligation, res: ProofObligationTaskResult, report: Report, mir: MirRenderer): string {
  const parts = [
    section(mir, 'Verdict', () => {
      const why = r.message ?? r.errors.map(String).join('\n');
      return mir.note([`${r.origin.fromSym}: ${outcome(r)}`, ...(why ? [noHashes(why)] : []),
        `${po.description}; tactic ${noHashes(String(po.tactic))}; ${statsText(res.statistics)}`].join('\n'));
    }),
    section(mir, 'Goal', () => {
      const vars = po.goal.variables.map(v => v.id.shortName).join(' ');
      return mir.join([mir.note(`Goal${vars ? ` over ${vars}` : ''}`), mir.term(po.goal.body, true)], '\n');
    }),
  ];
  const model = r.model;
  if (model) { parts.push(mir.join([mir.note(model.kind === 'instance' ? 'Instance' : 'Counterexample'), mir.text(model.src.trim())], '\n')); }
  else if (res.model) { const m = res.model; parts.push(section(mir, 'Model', () => mir.note(`Model\n${modelLines(m, mir).join('\n')}`))); }
  const subgoals = res.subgoals ?? [];
  if (subgoals.length) { parts.push(section(mir, 'Remaining subgoals', () => mir.note(`Remaining subgoals\n${subgoals.map(g => sequentText(g, mir)).join('\n')}`))); }
  const proof = res.proof;
  if (proof) { parts.push(section(mir, 'Proof', () => mir.note(`Proof\n${proofLines(proof, mir).join('\n')}`))); }
  parts.push(reportSection(report, mir));
  return mir.document(parts);
}

export function decompDocument(res: DecompositionTaskResult, report: Report, mir: MirRenderer): string {
  const head = section(mir, 'Decomposition', () => {
    const d = res.decomposition;
    return mir.note([`decomposition of ${d?.id.shortName ?? res.from}: ${d ? `${d.regions.length} region(s)` : 'failed'}`,
      ...(res.error ? [noHashes(String(res.error))] : []), statsText(res.statistics)].join('\n'));
  });
  return mir.document([head, reportSection(report, mir)]);
}

// How a termination PO went, with the measure the SMT solver expanded (the default one has no name in the DB)
export function terminationText(r: ProofObligationResult, po: ProofObligation, report: Report, mir: MirRenderer): string {
  const smt = report.events.flatMap(e => (e.kind !== 'exitSpan' && e.event.kind === 'provedBySmt' ? [e.event] : []));
  const measures = [...new Set(smt.flatMap(e => measureExpansions(e.proof.expansions, mir)))];
  return [`termination PO ${outcome(r)} by ${noHashes(String(po.tactic))}${smt.length ? `, ${smt.length} SMT call(s)` : ''}`,
    ...measures.map(m => `measure: ${m}`)].join('\n');
}
