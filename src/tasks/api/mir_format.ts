// How the MIR DB view's documents show MIR: as readable IML, as the client's textual MIR or as its raw structure.
// Only types are imported from 'imandrax-api': the client itself is loaded lazily elsewhere.
import type { DB, Declaration, Term } from 'imandrax-api/dist/mir';
import { printDeclaration, printMirDeclaration, printMirTerm, printTerm } from './mir_printer';
import { comment } from './report_printer';

export const MIR_FORMATS = {
  iml: 'Readable IML (hover a name for its full ids)',
  mir: "The API client's textual MIR, with full ids",
  json: 'The raw MIR structure, as JSON',
} as const;
export type MirFormat = keyof typeof MIR_FORMATS;
export const asFormat = (s: unknown): MirFormat => (Object.keys(MIR_FORMATS) as MirFormat[]).find(f => f === s) ?? 'iml';
export const languageOf = (f: MirFormat) => (f === 'json' ? 'json' : 'imandrax');

type Printed = ReturnType<typeof printDeclaration>;

// A JSON document shows at most this many values; huge library declarations would freeze the editor
const MAX_JSON_VALUES = 20000;
const MAX_JSON_DEPTH = 500;

// One document's MIR in one format. A JSON document is an array of notes (strings) and raw values.
export class MirRenderer {
  private left = MAX_JSON_VALUES;

  // `iml`: prints a declaration as IML (a DB index's, to share its cache)
  constructor(readonly format: MirFormat, private readonly db?: DB,
    private readonly iml: (d: Declaration) => Printed = d => printDeclaration(d, db)) { }

  decl(d: Declaration): Printed {
    if (this.format === 'iml') { return this.iml(d); }
    return { text: this.format === 'mir' ? printMirDeclaration(d) : JSON.stringify(this.plain(d.raw), null, 2), fullIds: new Map() };
  }

  // `alone`: the term is a part of the document, not inside a note (as JSON: indented)
  term(t: Term, alone = false): string {
    if (this.format === 'iml') { return printTerm(t, this.db); }
    return this.format === 'mir' ? printMirTerm(t) : JSON.stringify(this.plain(t.raw), null, alone ? 2 : undefined);
  }

  note(s: string): string { return this.format === 'json' ? JSON.stringify(s) : comment(s); }
  // Verbatim text, e.g. a counterexample's IML
  text(s: string): string { return this.format === 'json' ? JSON.stringify(s) : s; }
  join(parts: readonly string[], sep = '\n\n'): string { return parts.join(this.format === 'json' ? ',\n' : sep); }

  document(parts: readonly string[]): string {
    if (this.format !== 'json') { return `${this.join(parts)}\n`; }
    const cut = this.left < 0 ? [this.note(`Truncated: a JSON document shows at most ${MAX_JSON_VALUES} values ("…" marks the rest)`)] : [];
    return `[\n${this.join([...parts, ...cut])}\n]\n`;
  }

  // `v` as JSON data: objects tagged with their class ("$"), sets as arrays, maps as [key, value] pairs, bigints
  // as strings, bytes (hashes) as base64url; "…" past the budget
  private plain(v: unknown, depth = 0): unknown {
    if (--this.left < 0 || depth > MAX_JSON_DEPTH) { this.left = Math.min(this.left, -1); return '…'; }
    if (typeof v === 'bigint') { return v.toString(); }
    if (v instanceof Uint8Array) { return Buffer.from(v).toString('base64url'); }
    if (typeof v !== 'object' || v === null) { return v; }
    const sub = (x: unknown) => this.plain(x, depth + 1);
    // Items while the budget lasts, then `more`
    const some = <T, U>(xs: Iterable<T>, f: (x: T) => U, more: U) => {
      const out: U[] = [];
      for (const x of xs) {
        if (this.left <= 0) { out.push(more); this.left = -1; break; }
        out.push(f(x));
      }
      return out;
    };
    if (Array.isArray(v) || v instanceof Set) { return some(v, sub, '…'); }
    if (v instanceof Map) { return some<[unknown, unknown], unknown>(v, ([k, x]) => [sub(k), sub(x)], '…'); }
    const tag = v.constructor && v.constructor !== Object ? [['$', v.constructor.name]] : [];
    return Object.fromEntries([...tag, ...some(Object.entries(v).filter(([, x]) => x !== undefined), ([k, x]) => [k, sub(x)], ['…', '…'])]);
  }
}
