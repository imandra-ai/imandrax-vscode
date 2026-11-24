// Readable text for task results and proof reports from the imandrax-api client, for read-only IML documents.
// Only types are imported from 'imandrax-api': the client itself is loaded lazily elsewhere.
import type { Model, Sequent, Term } from 'imandrax-api/dist/mir';
import type { AtomicEvent, Expansion, Report, RichText } from 'imandrax-api/dist/report';
import type { DecompositionTaskResult } from 'imandrax-api/dist/tasks';
import type { MirRenderer } from './mir_format';
import { noHashes } from './mir_printer';

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

const statsText = (s: DecompositionTaskResult['statistics']) =>
  [secs(s.timeS), ...(s.tactic ?? []).map(t => `${t.name} ${t.value}`)].join(', ');

// A section's text, or a note in its place: one unexpected shape loses that section, not the document
const section = (mir: MirRenderer, title: string, f: () => string) => {
  try { return f(); } catch (e) { return mir.note(`${title}: could not print (${e instanceof Error ? e.message : String(e)})`); }
};
const reportSection = (report: Report, mir: MirRenderer) =>
  section(mir, 'Report', () => mir.note(`Report\n${reportLines(report, mir).join('\n') || '(no events)'}`));

export function decompDocument(res: DecompositionTaskResult, report: Report, mir: MirRenderer): string {
  const head = section(mir, 'Decomposition', () => {
    const d = res.decomposition;
    return mir.note([`decomposition of ${d?.id.shortName ?? res.from}: ${d ? `${d.regions.length} region(s)` : 'failed'}`,
      ...(res.error ? [noHashes(String(res.error))] : []), statsText(res.statistics)].join('\n'));
  });
  return mir.document([head, reportSection(report, mir)]);
}
