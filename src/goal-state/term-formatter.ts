/**
 * Wadler's Pretty Printing Algorithm
 * Based on "A Prettier Printer" by Philip Wadler (1997)
 *
 * The algorithm works in two phases:
 *   1. Build a Doc tree using the combinators below
 *   2. Render to a string with `pretty(width, doc)`
 */

/** All credits to Phil and Claude. */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import sanitize = require('sanitize-html');

import * as IXT from "./imandrax_types"
import * as IXO from "./imandrax_operators"

/**
 * A string with an additional visual length. The HTML we produce is much larger
 * than the size of the string that will be rendered, so layout decisions are
 * based on the acutal, visual length of the string, while the content produced
 * can be of a different length.
 */
class VisString {
  public content: string;
  public visual_length: number;

  constructor(content: string, visual_length?: number) {
    this.content = content;
    this.visual_length = visual_length ?? content.length;
  }
}

// ---------------------------------------------------------------------------
// Doc — the main algebraic data type
// ---------------------------------------------------------------------------

export type Doc =
  | { readonly tag: "NIL" }
  | { readonly tag: "LINE" }
  | { readonly tag: "LINEBREAK" }
  | { readonly tag: "TEXT"; readonly s: VisString }
  | { readonly tag: "CONCAT"; readonly x: Doc; readonly y: Doc }
  | { readonly tag: "NEST"; readonly i: number; readonly x: Doc }
  | { readonly tag: "UNION"; readonly x: Doc; readonly y: Doc };  // x flat, y broken

// ---------------------------------------------------------------------------
// SimpleDoc — intermediate representation after layout selection
// ---------------------------------------------------------------------------

type SimpleDoc =
  | { readonly tag: "SNIL" }
  | { readonly tag: "STEXT"; readonly s: VisString; readonly rest: SimpleDoc }
  | { readonly tag: "SLINE"; readonly i: number; readonly rest: SimpleDoc };

// ---------------------------------------------------------------------------
// Internal constructors (kept private to the module)
// ---------------------------------------------------------------------------

const NIL: Doc = { tag: "NIL" };
const LINE: Doc = { tag: "LINE" };
const LINEBREAK: Doc = { tag: "LINEBREAK" };

const TEXT = (s: VisString): Doc => ({ tag: "TEXT", s });
const CONCAT = (x: Doc, y: Doc): Doc => ({ tag: "CONCAT", x, y });
const NEST_ = (i: number, x: Doc): Doc => ({ tag: "NEST", i, x });
const UNION = (x: Doc, y: Doc): Doc => ({ tag: "UNION", x, y });

const SNIL: SimpleDoc = { tag: "SNIL" };
const STEXT = (s: VisString, rest: SimpleDoc): SimpleDoc => ({ tag: "STEXT", s, rest });
const SLINE = (i: number, rest: SimpleDoc): SimpleDoc => ({ tag: "SLINE", i, rest });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Flatten a document: LINE → space, LINEBREAK → empty, everything else unchanged. */
function flatten(doc: Doc): Doc {
  switch (doc.tag) {
    case "NIL": return NIL;
    case "TEXT": return doc;
    case "LINE": return TEXT(new VisString(" ", 1));
    case "LINEBREAK": return NIL;
    case "CONCAT": return CONCAT(flatten(doc.x), flatten(doc.y));
    case "NEST": return NEST_(doc.i, flatten(doc.x));
    case "UNION": return flatten(doc.x);  // x is already the flat branch
  }
}

/** Does `sdoc` fit within `remaining` columns before the next newline? */
function fits(remaining: number, sdoc: SimpleDoc): boolean {
  let r = remaining;
  let s = sdoc;
  while (true) {
    if (r < 0) return false;
    if (s.tag === "SNIL") return true;
    if (s.tag === "SLINE") return true;   // newline resets the budget
    // s.tag === "STEXT"
    r -= s.s.visual_length;
    s = s.rest;
  }
}

// ---------------------------------------------------------------------------
// Core layout algorithm
// ---------------------------------------------------------------------------

type WorkItem = [indent: number, doc: Doc];

/**
 * Select the best layout for a document given a page width `w` and the number
 * of characters `k` already placed on the current line.
 *
 * Uses an iterative trampoline to avoid call-stack overflows on large documents.
 */
function best(w: number, k: number, docs: WorkItem[]): SimpleDoc {
  // Iterative state machine: either "still processing" or a final SimpleDoc.
  interface Step { type: "step"; w: number; k: number; docs: WorkItem[] }
  type State = Step | SimpleDoc;

  let state: State = { type: "step", w, k, docs };

  while ("type" in state && state.type === "step") {
    const curW: number = state.w;
    const curK: number = state.k;
    const curDocs: WorkItem[] = state.docs;

    if (curDocs.length === 0) {
      state = SNIL;
      break;
    }

    const [[i, doc], ...rest]: WorkItem[] = curDocs as [WorkItem, ...WorkItem[]];
    const w = curW;
    const k = curK;

    switch (doc.tag) {
      case "NIL":
        state = { type: "step", w, k, docs: rest };
        break;

      case "CONCAT":
        state = { type: "step", w, k, docs: [[i, doc.x], [i, doc.y], ...rest] };
        break;

      case "NEST":
        state = { type: "step", w, k, docs: [[i + doc.i, doc.x], ...rest] };
        break;

      case "TEXT":
        state = STEXT(doc.s, best(w, k + doc.s.visual_length, rest));
        break;

      case "LINE":
      case "LINEBREAK":
        state = SLINE(i, best(w, i, rest));
        break;

      case "UNION": {
        const flat = best(w, k, [[i, doc.x], ...rest]);
        const broken = best(w, k, [[i, doc.y], ...rest]);
        state = fits(w - k, flat) ? flat : broken;
        break;
      }
    }
  }

  return state as SimpleDoc;
}

/** Render a SimpleDoc to a string. */
function layout(sdoc: SimpleDoc): string {
  const parts: string[] = [];
  let s = sdoc;
  while (s.tag !== "SNIL") {
    if (s.tag === "STEXT") {
      parts.push(s.s.content);
      s = s.rest;
    } else {
      // SLINE
      parts.push("\n" + "\t".repeat(s.i));
      s = s.rest;
    }
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Public API — primitives
// ---------------------------------------------------------------------------

/** The empty document. */
export const nil: Doc = NIL;

/** A breakable newline. Inside `group`, becomes a space if the line fits. */
export const line: Doc = LINE;

/** A breakable newline that becomes empty (not a space) when flattened. */
export const linebreak: Doc = LINEBREAK;

/** A literal text string (must not contain newlines). */
export const text = (s: string): Doc =>
  s.length === 0 ? NIL : TEXT(new VisString(s));

export const vtext = (s: string, l: number): Doc =>
  s.length === 0 ? NIL : TEXT(new VisString(s, l));

// ---------------------------------------------------------------------------
// Public API — combinators
// ---------------------------------------------------------------------------

/** Concatenate two documents. */
export const concat = (x: Doc, y: Doc): Doc => {
  if (x.tag === "NIL") return y;
  if (y.tag === "NIL") return x;
  return CONCAT(x, y);
};

/** Concatenate an array of documents left-to-right. */
export const hcat = (docs: Doc[]): Doc =>
  docs.reduce(concat, NIL);

/** Concatenate documents with `sep` between each pair. */
export const punctuate = (sep: Doc, docs: Doc[]): Doc => {
  if (docs.length === 0) return NIL;
  return docs.reduce((acc, d) => concat(acc, concat(sep, d)));
};

/** Indent nested content by `i` additional spaces. */
export const nest = (i: number, x: Doc): Doc => NEST_(i, x);

/**
 * Try to lay out the document on a single line; if it doesn't fit within the
 * page width, fall back to the normal (multi-line) layout.
 */
export const group = (x: Doc): Doc => UNION(flatten(x), x);

// ---------------------------------------------------------------------------
// Public API — derived separators
// ---------------------------------------------------------------------------

/** Lay out documents separated by spaces (never breaks). */
export const hsep = (docs: Doc[]): Doc => punctuate(text(" "), docs);

/** Lay out documents separated by `line` (spaces or newlines). */
export const vsep = (docs: Doc[]): Doc => punctuate(line, docs);

/** Try to fill a line; break with a newline only when necessary. */
export const fill = (docs: Doc[]): Doc => punctuate(group(line), docs);

// ---------------------------------------------------------------------------
// Public API — enclosures
// ---------------------------------------------------------------------------

/** Wrap a document between two delimiter documents. */
export const enclose = (l: Doc, r: Doc, x: Doc): Doc =>
  concat(l, concat(x, r));

export const parens = (x: Doc): Doc => enclose(text("("), text(")"), x);
export const brackets = (x: Doc): Doc => enclose(text("["), text("]"), x);
export const braces = (x: Doc): Doc => enclose(text("{"), text("}"), x);
export const angles = (x: Doc): Doc => enclose(text("<"), text(">"), x);
export const squotes = (x: Doc): Doc => enclose(text("'"), text("'"), x);
export const dquotes = (x: Doc): Doc => enclose(text('"'), text('"'), x);

// ---------------------------------------------------------------------------
// Public API — list layouts
// ---------------------------------------------------------------------------

/**
 * Lay out `docs` between `ldelim`/`rdelim` separated by `sep`.
 * Tries the flat layout first; falls back to one item per line.
 */
export const encloseSep = (
  ldelim: Doc,
  rdelim: Doc,
  sep: Doc,
  docs: Doc[],
): Doc => {
  if (docs.length === 0) return concat(ldelim, rdelim);
  if (docs.length === 1) return concat(ldelim, concat(docs[0], rdelim));
  const seps: Doc[] = [ldelim, ...Array<Doc>(docs.length - 1).fill(sep)];
  const body = hcat(docs.map((d, i) => concat(seps[i], d)));
  return group(concat(body, rdelim));
};

/** Format a comma-separated list in square brackets: [a, b, c] */
export const list = (docs: Doc[]): Doc =>
  encloseSep(text("["), text("]"), text(", "), docs);

/** Format a comma-separated tuple in parentheses: (a, b, c) */
export const tupled = (docs: Doc[]): Doc =>
  encloseSep(text("("), text(")"), text(", "), docs);

// ---------------------------------------------------------------------------
// Public API — main entry point
// ---------------------------------------------------------------------------

/**
 * Pretty-print `doc` to a string, fitting within `width` columns where
 * possible.
 *
 * @param width  Maximum line width (e.g. 80)
 * @param doc    A Doc built with the combinators above
 */
export function pretty(width: number, doc: Doc): string {
  return layout(best(width, 0, [[0, doc]]));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function join(e: Doc, docs: Doc[]): Doc {
  if (docs.length == 0)
    return nil;
  else if (docs.length == 1)
    return docs[0];
  else {
    let r: Doc[] = [docs[0]];
    for (let i = 1; i < docs.length; i++)
      r = r.concat([e, docs[i]]);
    return hcat(r);
  }
}

function indent(ds: Doc[]): Doc {
  return nest(1, hcat(ds));
}

function g(ds: Doc[]): Doc {
  return group(hcat(ds));
}

function par_if(c: boolean, ds: Doc[]): Doc {
  if (c)
    return parens(hcat(ds));
  else
    return hcat(ds);
}

// ---------------------------------------------------------------------------
// ImandraX-specific stuff from here on.
// ---------------------------------------------------------------------------

function hkw(w: string): string {
  return `<span class='keyword'>${w}</span>`;
}

function span(e: string, hover?: string): string {
  if (hover !== undefined)
    return `<span class='hoverable' data-hover='${hover.replaceAll("'", "&#39;")}'>${e}</span>`;
  else
    return `<span>${e}</span>`;
}

function hcmdspan(e: string, cmd: string, args: object) {
  return `<span class='${cmd}' arguments='${JSON.stringify(args).replaceAll("'", "&#39;")}'>${e}</span>`;
}

function htype(w: string): string {
  return `<span class='type'>${sanitize(w)}</span>`;
}

function hvaluedef(w: string): string {
  return `<span class='value-definition'>${sanitize(w)}</span>`;
}

function hid(w: string, id: string): string {
  return `<span class='identifier' name='${id}'>${w}</span>`;
}

function vconstant(w: string): VisString {
  return new VisString(`<span class='constant'>${sanitize(w)}</span>`, w.length);
}

function vstring_constant(w: string): VisString {
  return new VisString(`<span class='string-constant'>${sanitize(w)}</span>`, w.length);
}

function vbool_constant(w: string): VisString {
  return new VisString(`<span class='bool-constant'>${sanitize(w)}</span>`, w.length);
}

function kw(w: string): Doc {
  return vtext(hkw(w), w.length);
}

class TermFormatter {
  private _abort_signal: AbortSignal | undefined;
  private _width: number;
  private _po: IXT.ProofObligation | undefined;

  constructor(width: number, po?: IXT.ProofObligation, abort_signal?: AbortSignal) {
    this._width = width;
    this._po = po;
    this._abort_signal = abort_signal;
  }

  sym2doc(s: IXT.AppliedSymbol, definition?: string, hover_enabled = true): Doc {
    this._abort_signal?.throwIfAborted();

    let hover: string | undefined = hover_enabled ? sanitize(hvaluedef(s.id)) + " : " + htype(sanitize(s.type)) : undefined;
    if (hover_enabled && definition) hover += sanitize(definition);
    const sid = IXT.short_id(s.id);

    // Map operator names to their visual form if different, e.g. `iff` vs `<==>`
    const op_info = IXO.operator_info(sid);
    const op_name = op_info.name == "" ? sid : op_info.name;

    return vtext(span(hid(op_name, s.id), hover), op_name.length);
  }

  const2doc(c: IXT.Constant, type: string, hover_enabled: boolean): Doc {
    this._abort_signal?.throwIfAborted();

    let c_vstr: VisString;
    switch (c.view.constructor) {
      case "Const_float": c_vstr = vconstant(c.view.v.toString()); break;
      case "Const_string": c_vstr = vstring_constant(`"${c.view.v}"`); break;
      case "Const_z": c_vstr = vconstant(c.view.v.toString()); break;
      case "Const_q": {
        let q = c.view.num.toString() + ".0";
        if (c.view.den != BigInt(1))
          q = `${q} /. ${c.view.den.toString()}.0`;
        c_vstr = new VisString(vconstant(q).content, q.length);
        break;
      }
      case "Const_real_approx": c_vstr = vconstant(c.view.v); break;
      case "Const_uid": c_vstr = vconstant(c.view.v); break;
      case "Const_bool": c_vstr = vbool_constant(c.view.v ? "true" : "false"); break;
      default:
        c_vstr = new VisString(JSON.stringify(c));
    }
    const r_str = span(c_vstr.content, hover_enabled ? c_vstr.content + " : " + htype(type) : undefined);
    return TEXT(new VisString(r_str, c_vstr.visual_length));
  }

  term2doc(t: IXT.Term, hover_enabled = true): Doc {
    this._abort_signal?.throwIfAborted();

    const rec = (x: IXT.Term) => this.term2doc(x, hover_enabled);
    const rec_nohover = (x: IXT.Term) => this.term2doc(x, false);
    const sts = (w: string, h?: string): string => { return hover_enabled ? span(w, h) : span(w) };
    const recwp = (parent_oi: IXO.OperatorInfo, x: IXT.Term, is_left?: boolean) => {
      const child_oi = IXO.operator_info_of_term(x);
      const needs_par = IXO.needs_parentheses(parent_oi, child_oi, is_left) ||
        (x.view.constructor == "Const" &&
          x.view.c.view.constructor == "Const_q" &&
          x.view.c.view.den != BigInt(1) &&
          parent_oi.precedence > IXO.operator_info("/.").precedence);
      return par_if(needs_par, [rec(x)]);
    }

    const v = t.view;
    switch (v.constructor) {
      case "Const":
        return this.const2doc(v.c, t.type, hover_enabled);
      case "If":
        return g([
          g([
            kw("if"), indent([line, rec(v.c)]), line, kw("then")]),
          indent([line, rec(v.t)]), line,
          kw("else"), indent([line, rec(v.f)])
        ]);
      case "Apply":
        {
          let fn = rec(v.f);
          if (v.f.view.constructor == "Sym") {
            if (this._po && fn.tag == "TEXT") {
              fn = vtext(hcmdspan(fn.s.content, "expandable", { id: v.f.view.sym.id, anchor: this._po?.anchor }), fn.s.visual_length);
            }
            const sid = IXT.short_id(v.f.view.sym.id);
            const pi = IXO.operator_info(sid, v.l.length > 1);

            if (v.l.length == 0)
              return fn;
            else {
              switch (pi.notation) {
                case IXO.Notation.Infix: {
                  if (v.l.length == 2) {
                    const lhs = recwp(pi, v.l[0], true);
                    const rhs = recwp(pi, v.l[1], false);
                    return g([lhs, line, fn, line, rhs]);
                  }
                  else {
                    const hargs = indent([line, join(line, v.l.map(x => recwp(pi, x)))]);
                    return g([text("( "), fn, text(" )"), hargs]);
                  }
                }
                default: {
                  const hargs = indent([line, join(line, v.l.map(x => recwp(pi, x)))]);
                  return v.l.length == 0 ? fn : g([fn, hargs]);
                }
              }
            }
          }
          else {
            // fn is a function term
            const hargs = indent([line, join(line, v.l.map(x => recwp(IXO.default_(), x)))]);
            return par_if(v.l.length > 0, [fn, hargs]);
          }
          break;
        }
      case "Var": {
        const sid = IXT.short_id(v.id);
        return vtext(sts(sid, v.id + " : " + htype(t.type)), sid.length);
      }
      case "Sym":
        {
          const s: IXT.AppliedSymbol = v.sym;
          const def = this._po?.definitions.find((x: IXT.Definition) => x.name == s.id);
          if (hover_enabled && def) {
            const pretty_body = pretty(Math.max(this._width * 0.5, 16), indent([rec_nohover(def.body)]));
            const extra = " =<br/>" + hkw("fun") + " " + def.vars.join(" ") + " -> " + pretty_body;
            return this.sym2doc(s, extra, hover_enabled);
          }
          else
            return this.sym2doc(s, undefined, hover_enabled);
        }
      case "Construct": {
        if (v.args.length == 0)
          return text(IXT.short_id(v.c.id));
        else {
          const op_doc = this.sym2doc(v.c, undefined, hover_enabled);
          const sid = IXT.short_id(v.c.id);
          const pi = IXO.operator_info(sid, v.args.length > 1);
          switch (pi.notation) {
            case IXO.Notation.Infix: {
              if (v.args.length == 2) {
                const lhs = recwp(pi, v.args[0], true);
                const rhs = recwp(pi, v.args[1], false);
                return g([lhs, line, op_doc, line, rhs]);
              }
              else {
                const hargs = indent([line, join(line, v.args.map(x => recwp(pi, x)))]);
                return g([text("( "), op_doc, text(" )"), hargs]);
              }
            }
            default: {
              const args = v.args.map(rec);
              return g([par_if(true, [op_doc, indent([line, join(line, args)])])]);
            }
          }
        }
      }
      case "Destruct":
        return parens(g([
          kw("destruct"),
          brackets(hcat([
            this.sym2doc(v.c, undefined, hover_enabled),
            text("|"),
            text(v.i.toString())])),
          line,
          rec(v.t)]));
      case "Is_a": {
        return g([rec(v.t), line, kw("is_a"), indent([line, this.sym2doc(v.c, undefined, hover_enabled)])]);
      }
      case "Tuple": return g([parens(indent([join(hcat([text(","), line]), v.l.map(rec))]))]);
      case "Field": return g([rec(v.t), text("."), linebreak, text(IXT.short_id(v.f.id))]);
      case "Tuple_field": return g([rec(v.t), text("."), linebreak, text(v.i.toString())]);
      case "Record": {
        const hrows: Doc = join(hcat([text(";"), line]), v.rows.map(([sym, term]) =>
          g([
            this.sym2doc(sym, undefined, hover_enabled),
            text(":"),
            rec(term)])));
        const hrest: Doc = v.rest ? g([rec(v.rest), line, kw("with"), line]) : nil;
        return braces(hcat([hrest, hrows]));
      }
      case "Case": {
        const hcases = join(line, v.cases.map(([sym, term]) => g([
          text("|"),
          line,
          this.sym2doc(sym, undefined, hover_enabled),
          line,
          text("->"),
          line,
          rec(term)])));
        const hdefault = v.default ? g([line, text("|"), line, text("_"), line, text("->"), line, rec(v.default)]) : nil;
        return g([kw("case"), line, rec(v.u), kw("of"), line, hcases, hdefault]);
      }
      case "Sequence": {
        const hseq = join(hcat([text(";"), line]), v.s[0].map(rec));
        return g([hseq, rec(v.s[1])]);
      }
    }

    throw new Error(`Unhandled term: ${JSON.stringify(t)}`);
  }

  prettify(t: IXT.Term): string {
    this._abort_signal?.throwIfAborted();

    return pretty(this._width, this.term2doc(t));
  }
}

/**
 * Pretty-print term `t` with `width` line size, with an optional `po` for context
 * (e.g. to look up definitions of lambdas).
 */
export function prettify(width: number, t: IXT.Term, po?: IXT.ProofObligation  , abort_signal?: AbortSignal): string {
  try {
    return new TermFormatter(width, po, abort_signal).prettify(t);
  }
  catch (e) {
    console.log(e);
    if (e !== null && typeof e === 'object' && "name" in e && e.name == "AbortError")
      throw e;
    else if (e instanceof Error) {
      return e.toString();
    }
    else
      return "Caught unknown formatting error";
  }
}