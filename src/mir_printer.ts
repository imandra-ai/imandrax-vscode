// Readable IML for MIR declarations from the imandrax-api client.
// Only types are imported from 'imandrax-api': the client itself is loaded lazily elsewhere.
import type { AppliedSymbol, DB, Declaration, FunctionDefinition, Term, Type, TypeDefinition, Uid } from 'imandrax-api/dist/mir';
import { Associativity, Notation, operator_info, strip_scope, type OperatorInfo } from './goal-state/imandrax_operators';

const noHashes = (s: string) => s.replace(/\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '');

const ATOM = 100;
const EPS = 0.01;

// operator_info quirks: "==>" etc. would hit the "=…"/"<…" rules, "!=" the prefix-"!" rule.
const OP_ALIAS: Record<string, string> = { '==>': 'implies', '<==': 'explies', '<==>': 'iff', '!=': '<>' };
const opInfo = (name: string, nargs: number): OperatorInfo => operator_info(OP_ALIAS[name] ?? name, nargs > 1);
const WORD_OPS = new Set(['mod', 'land', 'lor', 'lxor', 'lsl', 'lsr', 'asr', 'or', 'implies', 'explies', 'iff']);
const isOp = (name: string) => /^[!$%&*+\-./:<=>?@^|~#]+$/.test(strip_scope(name)) || WORD_OPS.has(strip_scope(name));
// `List.@` -> `List.(@)`, `*` -> `( * )`; ordinary names unchanged.
const opName = (name: string): string => {
  if (!isOp(name)) return name;
  const op = strip_scope(name);
  return `${name.slice(0, name.length - op.length)}(${op.startsWith('*') || op.endsWith('*') ? ` ${op} ` : op})`;
};

interface Frame { scrut: Term; ctor: Uid; names: Map<number, string> }
interface Lambda { def: FunctionDefinition; args: readonly Term[] }
const MAX_LAMBDA_DEPTH = 8;

// With `db`, lifted `$lambda` functions are inlined as `fun ... -> ...` at their use sites.
export function printDeclaration(decl: Declaration, db?: DB): { text: string; fullIds: ReadonlyMap<string, readonly string[]> } {
  const ids = new Map<string, Set<string>>();
  const reg = (text: string, u: Uid): string => {
    let s = ids.get(text);
    if (!s) ids.set(text, (s = new Set()));
    s.add(u.fullName);
    return text;
  };
  const nm = (u: Uid) => reg(u.shortName, u);

  const used = new Set<string>();
  const fresh = (base: string, numbered: boolean): string => {
    let n = numbered ? `${base}0` : base;
    for (let i = numbered ? 1 : 0; used.has(n); i++) n = `${base}${i}`;
    used.add(n);
    return n;
  };
  const frames: Frame[] = [];
  // Printed text of lambda parameters substituted by their (captured) arguments, by full var name.
  let env = new Map<string, string>();
  let depth = 0;
  const sameTerm = (a: Term, b: Term) =>
    a.kind === 'var' && b.kind === 'var' ? a.var.id.equals(b.var.id) : a.toString() === b.toString();

  // ---- types ----
  const typ = (t: Type, req = 0): string => {
    let s: string, p: number;
    switch (t.kind) {
      case 'variable': {
        const n = t.name.shortName;
        s = reg(n.startsWith("'") ? n : `'${n}`, t.name); p = 3; break;
      }
      case 'arrow': s = `${typ(t.domain, 2)} -> ${typ(t.codomain, 1)}`; p = 1; break;
      case 'tuple': s = t.elements.map((e) => typ(e, 3)).join(' * '); p = 2; break;
      case 'constructed': {
        const args = t.arguments.map((a) => typ(a, t.arguments.length > 1 ? 0 : 3));
        const pre = args.length === 0 ? '' : args.length === 1 ? `${args[0]} ` : `(${args.join(', ')}) `;
        s = `${pre}${nm(t.ctor)}`; p = 3; break;
      }
    }
    return p < req ? `(${s})` : s;
  };
  const arity = (t: Type): number => (t.kind === 'arrow' ? 1 + arity(t.codomain) : 0);

  // ---- terms ----
  // Infix/prefix operator applications; undefined for ordinary application.
  const applyOp = (t: Term): OperatorInfo | undefined => {
    if (t.kind !== 'apply' || t.function.kind !== 'symbol' || !isOp(t.function.symbol.id.shortName)) return undefined;
    const n = t.arguments.length;
    const oi = opInfo(t.function.symbol.id.shortName, n);
    if (oi.notation === Notation.Infix && n === 2) return oi;
    if (oi.notation === Notation.Prefix && oi.precedence !== 17 && n === 1) return oi;
    return undefined;
  };
  const listElems = (t: Term): Term[] | undefined => {
    const out: Term[] = [];
    while (t.kind === 'construct' && t.ctor.id.shortName === '::' && t.arguments.length === 2) {
      out.push(t.arguments[0]);
      t = t.arguments[1];
    }
    return t.kind === 'construct' && t.ctor.id.shortName === '[]' && t.arguments.length === 0 ? out : undefined;
  };
  // A lifted lambda applied to `args` (none for a bare symbol), if its definition is known.
  const lambda = (t: Term): Lambda | undefined => {
    const [f, args] = t.kind === 'apply' ? [t.function, t.arguments] : [t, []];
    if (f.kind !== 'symbol' || !f.symbol.id.shortName.startsWith('$lambda') || depth >= MAX_LAMBDA_DEPTH) return undefined;
    const def = db?.findFunction(f.symbol.id);
    return def?.kind.kind === 'defined' ? { def, args } : undefined;
  };
  // `fun`, `if` and `match` extend as far right as possible.
  const openEnded = (t: Term): boolean => {
    const l = lambda(t);
    if (!l) return t.kind === 'if' || t.kind === 'case';
    const n = l.def.arguments.length;
    return l.args.length < n || (l.args.length === n && openEnded(l.def.body));
  };
  const prec = (t: Term): number => {
    const l = lambda(t);
    if (l) {
      const n = l.def.arguments.length;
      return l.args.length < n ? 3 : l.args.length === n ? prec(l.def.body) : 17;
    }
    switch (t.kind) {
      case 'constant': return /^-|\//.test(t.value.toString()) ? 16 : ATOM;
      case 'apply': return t.arguments.length === 0 ? prec(t.function) : applyOp(t)?.precedence ?? 17;
      case 'construct':
        if (t.arguments.length === 0 || listElems(t)) return ATOM;
        return t.ctor.id.shortName === '::' && t.arguments.length === 2 ? 12 : 17;
      case 'field': case 'tupleField': return 18;
      case 'if': return 5;
      case 'sequence': return 4;
      case 'case': return 3;
      default: return ATOM;
    }
  };

  // `req`: minimum precedence the context accepts without parentheses.
  // `tail`: nothing follows in the enclosing construct, so open-ended if/match need no parentheses.
  const term = (t: Term, req: number, tail: boolean, ind: string): string => {
    const paren = prec(t) < req && !(tail && openEnded(t));
    const s = raw(t, paren || tail, ind);
    return paren ? `(${s})` : s;
  };

  const raw = (t: Term, tail: boolean, ind: string): string => {
    const sub = (x: Term, req = 0, tl = false) => term(x, req, tl, ind);
    const l = lambda(t);
    if (l) return inline(l, tail, ind);
    switch (t.kind) {
      case 'constant': {
        const v = t.value;
        return v.kind === 'uid' ? nm(v.uid) : v.toString();
      }
      case 'var': return env.get(t.var.id.fullName) ?? nm(t.var.id);
      case 'symbol': return opName(nm(t.symbol.id));
      case 'apply': {
        if (t.arguments.length === 0) return raw(t.function, tail, ind);
        const oi = applyOp(t);
        const f = t.function.kind === 'symbol' ? t.function.symbol : undefined;
        if (oi && f && t.arguments.length === 2) {
          const p = oi.precedence;
          const [l, r] = t.arguments;
          const lreq = oi.associativity === Associativity.Left ? p : p + EPS;
          const rreq = oi.associativity === Associativity.Right ? p : p + EPS;
          return `${sub(l, lreq)} ${reg(oi.name, f.id)} ${sub(r, rreq)}`;
        }
        if (oi && f) {
          const a = sub(t.arguments[0], oi.precedence + EPS);
          const op = reg(oi.name === '~-' || oi.name === '~-.' ? oi.name.slice(1) : oi.name, f.id);
          return a.startsWith('-') ? `${op} ${a}` : `${op}${a}`;
        }
        return [sub(t.function, 17), ...t.arguments.map((a) => sub(a, 17 + EPS))].join(' ');
      }
      case 'construct': {
        const elems = listElems(t);
        if (elems) {
          nm(t.ctor.id);
          return `[${elems.map((e) => sub(e, 4 + EPS)).join('; ')}]`;
        }
        const c = nm(t.ctor.id);
        const args = t.arguments;
        if (args.length === 0) return c;
        if (c === '::' && args.length === 2) return `${sub(args[0], 12 + EPS)} :: ${sub(args[1], 12)}`;
        const labels = t.labels;
        if (labels?.length === args.length)
          return `${c} { ${args.map((a, i) => `${nm(labels[i])} = ${sub(a, 4 + EPS)}`).join('; ')} }`;
        if (args.length === 1) return `${c} ${sub(args[0], 17 + EPS)}`;
        return `${c} (${args.map((a) => sub(a, 7 + EPS)).join(', ')})`;
      }
      case 'destruct': {
        for (let i = frames.length - 1; i >= 0; i--) {
          const fr = frames[i];
          if (fr.ctor.equals(t.ctor.id) && sameTerm(fr.scrut, t.term)) {
            let n = fr.names.get(t.index);
            if (n === undefined) {
              const list = t.ctor.id.shortName === '::';
              n = fresh(list ? (t.index === 0 ? 'hd' : 'tl') : 'x', !list);
              fr.names.set(t.index, n);
            }
            return n;
          }
        }
        return `Destruct(${nm(t.ctor.id)}, ${t.index}, ${sub(t.term, 0, true)})`;
      }
      case 'isA': return `Is_a(${nm(t.ctor.id)}, ${sub(t.term, 0, true)})`;
      case 'tuple': return `(${t.elements.map((e) => sub(e, 7 + EPS)).join(', ')})`;
      case 'field': return `${sub(t.term, 18)}.${nm(t.field.id)}`;
      case 'tupleField': return `${sub(t.term, 18)}.${t.index}`;
      case 'record': {
        const rows = t.rows.map((r) => `${nm(r.field.id)} = ${sub(r.value, 4 + EPS)}`).join('; ');
        return t.rest === undefined ? `{ ${rows} }` : `{ ${sub(t.rest, 18)} with ${rows} }`;
      }
      case 'if': {
        const c = sub(t.condition, 0, true);
        const a = term(t.thenBranch, 5 + EPS, false, ind + '  ');
        const e = t.elseBranch;
        const b = term(e, 5, tail, e.kind === 'if' ? ind : ind + '  ');
        const flat = `if ${c} then ${a} else ${b}`;
        return flat.length <= 60 && !flat.includes('\n') ? flat : `if ${c} then ${a}\n${ind}else ${b}`;
      }
      case 'case': {
        const scrut = sub(t.scrutinee, 0, true);
        const n = t.cases.length + (t.default ? 1 : 0);
        const arms = t.cases.map((arm, i) => {
          const fr: Frame = { scrut: t.scrutinee, ctor: arm.ctor.id, names: new Map() };
          frames.push(fr);
          const rhs = term(arm.rhs, 4, tail && i === n - 1, ind + '  ');
          frames.pop();
          for (const v of fr.names.values()) used.delete(v);
          return `| ${pattern(arm.ctor, fr.names)} -> ${rhs}`;
        });
        if (t.default) arms.push(`| _ -> ${term(t.default, 4, tail, ind + '  ')}`);
        return `match ${scrut} with${arms.map((a) => `\n${ind}${a}`).join('')}`;
      }
      case 'sequence': {
        const xs = [...t.prefix.map((x) => sub(x, 4 + EPS)), term(t.last, 4, tail, ind)];
        const flat = xs.join('; ');
        return flat.length <= 60 && !flat.includes('\n') ? flat : xs.join(`;\n${ind}`);
      }
    }
  };

  // Substitute the first min(m, n) params by the printed args, bind the rest with `fun`, apply to extra args.
  // ponytail: textual substitution, so an argument naming a var shadowed by a later binder would be captured.
  const inline = ({ def, args }: Lambda, tail: boolean, ind: string): string => {
    const ps = def.arguments;
    const k = Math.min(args.length, ps.length);
    const texts = args.map((a) => term(a, 17 + EPS, false, ind));
    const saved = env;
    env = new Map(env);
    ps.forEach((p, i) => (i < k ? env.set(p.id.fullName, texts[i]) : env.delete(p.id.fullName)));
    for (const p of ps) used.add(p.id.shortName);
    depth++;
    try {
      if (k < ps.length) return `fun ${ps.slice(k).map((p) => nm(p.id)).join(' ')} -> ${term(def.body, 0, tail, ind)}`;
      if (args.length === k) return raw(def.body, tail, ind);
      return [term(def.body, 17, false, ind), ...texts.slice(k)].join(' ');
    } finally {
      depth--;
      env = saved;
    }
  };

  const pattern = (ctor: AppliedSymbol, names: Map<number, string>): string => {
    const c = opName(nm(ctor.id));
    const n = Math.max(arity(ctor.type), ...[...names.keys()].map((i) => i + 1));
    if (n === 0) return c;
    const vs = Array.from({ length: n }, (_, i) => names.get(i) ?? '_');
    if (c === '(::)' && n === 2) return `${vs[0]} :: ${vs[1]}`;
    if (names.size === 0) return `${c} _`;
    return n === 1 ? `${c} ${vs[0]}` : `${c} (${vs.join(', ')})`;
  };

  // ---- declarations ----
  const definition = (kw: string, f: FunctionDefinition): string => {
    for (const a of f.arguments) used.add(a.id.shortName);
    for (const s of f.body) if (s.kind === 'var') used.add(s.var.id.shortName);
    const head = `${kw} ${opName(nm(f.name))}${f.arguments.map((a) => ` (${nm(a.id)} : ${typ(a.type)})`).join('')}`;
    const body = term(f.body, 0, true, '  ');
    return body.includes('\n') || head.length + body.length > 80 ? `${head} =\n  ${body}` : `${head} = ${body}`;
  };
  const typeDef = (d: TypeDefinition): string => {
    const ps = d.parameters.map((p) => reg(p.shortName.startsWith("'") ? p.shortName : `'${p.shortName}`, p));
    const head = `type ${ps.length === 0 ? '' : ps.length === 1 ? `${ps[0]} ` : `(${ps.join(', ')}) `}${nm(d.name)}`;
    const k = d.kind;
    if (k.kind === 'algebraic')
      return `${head} =${k.constructors.map((c) => {
        const cn = opName(nm(c.name));
        if (c.arguments.length === 0) return `\n  | ${cn}`;
        const labels = c.labels;
        if (labels?.length === c.arguments.length)
          return `\n  | ${cn} of { ${c.arguments.map((a, i) => `${nm(labels[i])} : ${typ(a)}`).join('; ')} }`;
        return `\n  | ${cn} of ${c.arguments.map((a) => typ(a, 3)).join(' * ')}`;
      }).join('')}`;
    if (k.kind === 'record') return `${head} = { ${k.fields.map((f) => `${nm(f.name)} : ${typ(f.type)}`).join('; ')} }`;
    return head;
  };

  let text: string;
  try {
    switch (decl.kind) {
      case 'type': text = typeDef(decl.type); break;
      case 'function': {
        const f = decl.function;
        if (f.kind.kind !== 'defined') {
          text = `val ${opName(nm(f.name))} : ${typ(f.type)} (* ${f.kind.kind} *)`;
          break;
        }
        const rec = f.clique !== undefined && [...f.clique].some((u) => u.equals(f.name));
        text = definition(rec ? 'let rec' : 'let', f);
        break;
      }
      case 'theorem': text = definition(decl.theorem.isAxiom ? 'axiom' : 'theorem', decl.function); break;
      case 'ruleSpec': text = definition('rule_spec', decl.function); break;
      case 'verify': {
        const f = decl.function;
        for (const s of f.body) if (s.kind === 'var') used.add(s.var.id.shortName);
        const body = term(f.body, 0, true, '  ');
        const args = f.arguments.map((a) => ` (${nm(a.id)} : ${typ(a.type)})`).join('');
        text = `${decl.verify.kind} (${args === '' ? body : `fun${args} -> ${body}`})`;
        break;
      }
    }
  } catch {
    // ponytail: any unexpected term shape falls back to the client's own printer.
    text = noHashes(decl.toString());
  }
  return { text, fullIds: new Map([...ids].map(([k, v]) => [k, [...v]])) };
}
