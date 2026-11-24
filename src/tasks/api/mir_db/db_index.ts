import type { Admission, DB, Declaration, PatternHead, Uid } from 'imandrax-api/dist/mir';
import { comment } from '../report_printer';
import { noHashes, printDeclaration } from '../mir_printer';

type Printed = ReturnType<typeof printDeclaration>;

// A rule of the DB: what kind, from which theorem (or rule spec / instantiation rule), on which pattern head
export interface Rule { kind: string; source: Uid; head: PatternHead | undefined }

export const headText = (h: PatternHead | undefined) =>
  h?.kind === 'symbol' ? h.uid.shortName : h?.kind === 'type' ? noHashes(h.type.toString()) : h?.toString() ?? '';
const ruleText = (r: Rule) => r.head ? `${r.kind} on ${headText(r.head)}` : r.kind;
export const measureText = (a: Admission) =>
  [a.measuredSubset.length ? `measured: ${a.measuredSubset.join(' ')}` : '', a.measureFunction ? `measure: ${a.measureFunction.shortName}` : '']
    .filter(Boolean).join(', ');
export const byName = (a: Uid, b: Uid) => a.shortName.localeCompare(b.shortName);
// `m`'s value at `k`, set to `init()` first if missing
export function at<K, V>(m: Map<K, V>, k: K, init: () => V): V {
  const v = m.get(k) ?? init();
  m.set(k, v);
  return v;
}

// The DB's tables index the same rules differently (rwRules by head, thmAsRw by theorem, fc and gen point
// into instRules): a table only adds the (kind, source) pairs no earlier one had
function rulesOf(db: DB): Rule[] {
  type Row = readonly [string, Uid, readonly (PatternHead | undefined)[]];
  const out: Rule[] = [];
  const seen = new Set<string>();
  const key = (kind: string, u: Uid) => `${kind} ${u.fullName}`;
  const table = (rows: Row[]) => {
    const fresh = rows.filter(([kind, u]) => !seen.has(key(kind, u)));
    for (const [kind, source, heads] of fresh) { for (const head of heads.length ? heads : [undefined]) { out.push({ kind, source, head }); } }
    for (const [kind, u] of fresh) { seen.add(key(kind, u)); }
  };
  const instKind = (k: string) => (k === 'forwardChaining' ? 'forward chaining' : 'generalization');
  table([...db.rwRules].flatMap(([h, rs]) => rs.map((r): Row => ['rewrite', r.name, [h]])));
  table([...db.instRules].map(([u, r]): Row => [instKind(r.kind), u, r.triggers.map(t => t.head)]));
  table([...db.elim].flatMap(([h, es]) => es.map((e): Row => ['elimination', e.name, [h]])));
  table([...db.fc].flatMap(([h, ts]) => ts.map((t): Row => ['forward chaining', t.instantiationRuleName, [h]])));
  table([...db.gen].flatMap(([h, ts]) => ts.map((t): Row => ['generalization', t.instantiationRuleName, [h]])));
  table([...db.thmAsRw, ...db.ruleSpecRwRules].map(([u, rs]): Row => ['rewrite', u, rs.map(r => r.head)]));
  table([...db.thmAsFc].map(([u, rs]): Row => ['forward chaining', u, rs.flatMap(r => r.triggers.map(t => t.head))]));
  table([...db.ruleSpecFc].map(([u, ts]): Row => ['forward chaining', u, ts.map(t => t.head)]));
  table([...db.thmAsElim].map(([u, es]): Row => ['elimination', u, es.map(() => undefined)]));
  table([...db.thmAsGen].map(([u, r]): Row => ['generalization', u, r.triggers.map(t => t.head)]));
  return out;
}

// A fetched DB and what the view derives from it, each computed on first use
export class DbIndex {
  readonly rules: readonly Rule[];
  private readonly printed = new Map<string, Printed>();
  private users?: Map<string, Uid[]>;

  constructor(readonly db: DB) { this.rules = rulesOf(db); }

  // Functions with a termination measure: the DB's admissions, and those in definitions' hints
  measured(): [Uid, Admission][] {
    const out = new Map<string, [Uid, Admission]>();
    for (const d of this.db.decls.values()) {
      if (d.kind === 'function' && d.function.hints.admission) { out.set(d.id.fullName, [d.id, d.function.hints.admission]); }
    }
    for (const [u, a] of this.db.admission) { out.set(u.fullName, [u, a]); }
    return [...out.values()];
  }

  // The declaration's IML, then the rules from or about it, its termination measure and its users
  // `termination`: how its termination PO went, if this task has it
  document(uid: Uid, termination?: string): Printed {
    const ids = new Map<string, Set<string>>();
    const reg = (p: Printed) => {
      for (const [k, vs] of p.fullIds) { vs.forEach(v => at(ids, k, () => new Set()).add(v)); }
      return p.text;
    };
    const name = (u: Uid) => reg({ text: u.shortName, fullIds: new Map([[u.shortName, [u.fullName]]]) });
    const decl = this.db.findDeclaration(uid);
    const parts = [decl ? reg(this.print(decl)) : `(* ${name(uid)} is not a declaration of this DB *)`];

    const measure = this.db.admission.get(uid) ?? (decl?.kind === 'function' ? decl.function.hints.admission : undefined);
    const rec = decl?.kind === 'function' && decl.function.clique !== undefined && [...decl.function.clique].some(u => u.equals(uid));
    const how = [measure && `[@@measure] ${measureText(measure) || 'default'}`, termination].filter(Boolean);
    if (how.length || rec) {
      // ponytail: without [@@measure] the DB has no admission; the default measure only shows in the PO's SMT proof
      parts.push(comment(`Termination: ${how.join('\n') || 'no [@@measure], and its termination PO is not in this task (check the file to see it)'}`));
    }

    // The same rule shows in several of the DB's tables (e.g. rwRules and thmAsRw)
    const rules = [...new Map(this.rules
      .filter(r => r.source.equals(uid) || (r.head?.kind === 'symbol' && r.head.uid.equals(uid)))
      .map(r => [`${r.kind} ${r.source.fullName} ${headText(r.head)}`, r])).values()];
    const own = rules.filter(r => r.source.equals(uid));
    if (own.length) { parts.push(`(* As rules: ${own.map(ruleText).join('; ')} *)`); }
    const bySource = new Map<string, Rule[]>();
    for (const r of rules.filter(x => !x.source.equals(uid))) { at(bySource, r.source.fullName, () => []).push(r); }
    if (bySource.size) {
      parts.push(`(* Rules about ${name(uid)} *)`);
      for (const rs of bySource.values()) {
        const src = this.db.findDeclaration(rs[0].source);
        parts.push(`(* ${rs.map(ruleText).join('; ')}, from ${name(rs[0].source)} *)${src ? `\n${reg(this.print(src))}` : ''}`);
      }
    }

    const users = this.usedBy(uid).sort(byName);
    const rows = Array.from({ length: Math.ceil(users.length / 6) }, (_, i) => users.slice(i * 6, i * 6 + 6).map(name).join(', '));
    parts.push(users.length ? `(* Used by (${users.length}):\n   ${rows.join(',\n   ')} *)` : '(* Used by: nothing in this DB *)');
    return { text: `${parts.join('\n\n')}\n`, fullIds: new Map([...ids].map(([k, v]) => [k, [...v]])) };
  }

  private print(d: Declaration): Printed {
    let p = this.printed.get(d.id.fullName);
    if (!p) { this.printed.set(d.id.fullName, (p = printDeclaration(d, this.db))); }
    return p;
  }

  // Declarations whose printed IML names `uid` (lifted lambdas count for the declarations they are inlined in)
  private usedBy(uid: Uid): Uid[] {
    if (!this.users) {
      this.users = new Map();
      for (const d of this.db.decls.values()) {
        if (d.id.shortName.startsWith('$lambda')) { continue; }
        for (const full of new Set([...this.print(d).fullIds.values()].flat())) {
          if (full !== d.id.fullName) { at(this.users, full, () => []).push(d.id); }
        }
      }
    }
    return [...this.users.get(uid.fullName) ?? []];
  }
}
