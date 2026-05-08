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
// 1. Document AST
// ---------------------------------------------------------------------------

interface Nil { tag: "nil" }
interface Text { tag: "text"; s: VisString }
interface Line { tag: "line" }
interface LineBreak { tag: "linebreak" }
interface Concat { tag: "concat"; left: Doc; right: Doc }
interface Nest { tag: "nest"; indent: number; doc: Doc }
interface Group { tag: "group"; doc: Doc }

type Doc = Nil | Text | Line | LineBreak | Concat | Nest | Group;

// ---------------------------------------------------------------------------
// 2. Smart constructors
// ---------------------------------------------------------------------------

export const nil: Doc = { tag: "nil" };
export const line: Doc = { tag: "line" };
export const linebreak: Doc = { tag: "linebreak" };
export const nest = (i: number, doc: Doc): Doc => ({ tag: "nest", indent: i, doc });
export const concat = (left: Doc, right: Doc): Doc => ({ tag: "concat", left, right });
export const group = (doc: Doc): Doc => ({ tag: "group", doc });

export const text = (s: string): Doc =>
  s.length === 0 ? nil : { tag: "text", s: new VisString(s) };

export const vtext = (s: string, l: number): Doc =>
  s.length === 0 ? nil : { tag: "text", s: new VisString(s, l) };

export function wordsToDoc(ws: string[]): Doc {
  let result = text(ws[0]);
  for (const w of ws.slice(1)) {
    result = concat(result, concat(group(line), text(w)));
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Iterative `best`
//
// Wadler's recursive `best` is replaced by an explicit work-stack of
// [indent, mode, doc] triples.  Column position is tracked as a mutable
// counter updated whenever a token is emitted.
//
// Modes:
//   FLAT  — newlines become spaces (inside a fitting group)
//   BREAK — newlines are real newlines
// ---------------------------------------------------------------------------

const FLAT = 0 as const;
const BREAK = 1 as const;
type Mode = typeof FLAT | typeof BREAK;

type SimpleToken = ["text", VisString] | ["line", number];

type Frame = [indent: number, mode: Mode, doc: Doc];

function best(width: number, doc: Doc): SimpleToken[] {
  const result: SimpleToken[] = [];
  let col = 0;

  const stack: Frame[] = [[0, BREAK, doc]];

  while (stack.length > 0) {
    const [indent, mode, d] = stack.pop()!;

    switch (d.tag) {
      case "nil":
        break;

      case "text":
        result.push(["text", d.s]);
        col += d.s.visual_length;
        break;

      case "line":
        if (mode === FLAT) {
          result.push(["text", new VisString(" ")]);
          col += 1;
        } else {
          result.push(["line", indent]);
          col = indent;
        }
        break;

      case "linebreak":
        if (mode !== FLAT) {
          result.push(["line", indent]);
          col = indent;
        } // else nothing.
        break;

      case "concat":
        stack.push([indent, mode, d.right]);
        stack.push([indent, mode, d.left]);
        break;

      case "nest":
        stack.push([indent + d.indent, mode, d.doc]);
        break;

      case "group":
        if (mode === FLAT) {
          stack.push([indent, FLAT, d.doc]);
        } else {
          const m: Mode = fits(width - col, d.doc) ? FLAT : BREAK;
          stack.push([indent, m, d.doc]);
        }
        break;
    }
  }

  return result;
}

function fits(remaining: number, doc: Doc): boolean {
  const stack: Doc[] = [doc];
  let rem = remaining;

  while (stack.length > 0) {
    if (rem < 0)
      return false;

    const d = stack.pop()!;

    switch (d.tag) {
      case "nil":
      case "linebreak":
        break;
      case "line":
        rem -= 1;
        break;
      case "text":
        rem -= d.s.visual_length;
        break;
      case "concat":
        stack.push(d.right);
        stack.push(d.left);
        break;
      case "nest":
      case "group":
        stack.push(d.doc);
        break;
    }
  }

  return rem >= 0;
}

// ---------------------------------------------------------------------------
// 4. Render tokens to a string
// ---------------------------------------------------------------------------

function layout(tokens: SimpleToken[]): string {
  return tokens
    .map(([kind, val]) =>
      kind === "text" ? val.content : "\n" + "\t".repeat(val)
    )
    .join("");
}

export function pretty(width: number, doc: Doc): string {
  return layout(best(width, doc));
}

// ---------------------------------------------------------------------------
// Public API — combinators
// ---------------------------------------------------------------------------

/** Concatenate an array of documents left-to-right. */
export const hcat = (docs: Doc[]): Doc =>
  docs.reduce(concat, nil);

/** Concatenate documents with `sep` between each pair. */
export const punctuate = (sep: Doc, docs: Doc[]): Doc => {
  if (docs.length === 0) return nil;
  return docs.reduce((acc, d) => concat(acc, concat(sep, d)));
};

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
export const enclose = (left: string, right: string, x: Doc, hover?: string): Doc => {
  const leh = hover ? `<span class='hoverable' data-hover='${hover.replaceAll("'", "&#39;")}'>${left}</span>` : left;
  const reh = hover ? `<span class='hoverable' data-hover='${hover.replaceAll("'", "&#39;")}'>${right}</span>` : right;
  return hcat([vtext(`<span class='enclosed'><span>${leh}</span>`, left.length), x, vtext(`<span>${reh}</span></span>`, right.length)]);
}

export const parens = (x: Doc, hover?: string): Doc => enclose("(", ")", x, hover);
export const brackets = (x: Doc, hover?: string): Doc => enclose("[", "]", x, hover);
export const braces = (x: Doc, hover?: string): Doc => enclose("{", "}", x, hover);
export const angles = (x: Doc, hover?: string): Doc => enclose("<", ">", x, hover);
export const squotes = (x: Doc, hover?: string): Doc => enclose("'", "'", x, hover);
export const dquotes = (x: Doc, hover?: string): Doc => enclose('"', '"', x, hover);

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

function par_if(c: boolean, ds: Doc[], hover: string): Doc {
  if (c)
    return parens(hcat(ds), hover);
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

function hconstructorid(w: string, id: string): string {
  return `<span class='identifier constructor-name' name='${id}'>${w}</span>`;
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
  private _goal: IXT.Goal | undefined;
  private _with_turnstile = false;

  constructor(width: number, goal?: IXT.Goal, abort_signal?: AbortSignal, with_turnstile?: boolean) {
    this._width = width;
    this._goal = goal;
    this._abort_signal = abort_signal;
    if (with_turnstile !== undefined)
      this._with_turnstile = with_turnstile;
  }

  sym2doc(s: IXT.AppliedSymbol, definition?: string, hover_enabled = true, id_fun = hid): Doc {
    this._abort_signal?.throwIfAborted();

    const sid = IXT.short_id(s.id);

    let hover: string | undefined = undefined;
    if (hover_enabled) {
      const hash = (s.id.length > sid.length) ? s.id.substring(sid.length) : "";
      hover = hvaluedef(sid) + `<span class='hash'>${hash}</span> : ` + htype(sanitize(s.type));
    }
    if (hover_enabled && definition) hover += sanitize(definition);

    // Map operator names to their visual form if different, e.g. `iff` vs `<==>`
    const op_info = IXO.operator_info(sid);
    let op_name = op_info.name == "" ? sid : op_info.name;

    // Strip all module names preceding the op_name; it's still in the hover if
    // the user needs to see it.
    const dot_inx = sid.lastIndexOf(".");
    if (dot_inx > 0 && dot_inx < sid.length - 1)
      op_name = sid.substring(dot_inx + 1);

    return vtext(span(id_fun(op_name, s.id), hover), op_name.length);
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
    return vtext(r_str, c_vstr.visual_length);
  }

  get_string_const(t: IXT.Term): string | undefined {
    const v = t.view;
    if (v.constructor == "Const" && v.c.view.constructor == "Const_string")
      return v.c.view.v;
    return undefined;
  }

  subterm_selection2doc(t: IXT.Term[]): Doc {
    const t2d = (x: IXT.Term) => this.term2doc(x, true);

    const rs = t.map(t => {
      const v = t.view;
      switch (v.constructor) {
        case "Apply": {
          if (v.f.view.constructor == "Sym") {
            switch (v.f.view.sym.id) {
              case "subterm_selection_index":
                return g([kw("index"), parens(indent([linebreak, t2d(v.l[0])]))]);
              case "subterm_selection_nth":
                return g([kw("nth"), parens(indent([linebreak, t2d(v.l[0])]))]);
              case "subterm_selection_lhs":
                return kw("lhs");
              case "subterm_selection_rhs":
                return kw("rhs");
              default:
                return t2d(t);
            }
          }
          else
            return t2d(t);
        }
        case "Tuple": {
          if (v.l.length == 2) {
            switch (this.get_string_const(v.l[0])) {
              case "at": return g([kw("at"), indent([line, parens(t2d(v.l[1]))])]);
              case "in": return g([kw("in"), indent([line, parens(t2d(v.l[1]))])]);
              default: return t2d(t);
            }
          }
          else
            return t2d(t);
        }
        default:
          return t2d(t);
      }
    }
    );

    return join(line, rs);
  }

  term2doc(t: IXT.Term, hover_enabled = true): Doc {
    this._abort_signal?.throwIfAborted();

    const rec = (x: IXT.Term) => this.term2doc(x, hover_enabled);
    const rec_nohover = (x: IXT.Term) => this.term2doc(x, false);
    const sts = (w: string, h?: string): string => { return hover_enabled ? span(w, h) : span(w) };
    const recwp = (parent_oi: IXO.OperatorInfo, x: IXT.Term, is_left?: boolean) => {
      const child_oi = IXO.operator_info_of_term(x);
      const needs_par = IXO.needs_parentheses(parent_oi, child_oi, is_left, IXT.has_multiple_children(x)) ||
        ( // Special case for rationals: they are treated as constants, but really are
          // applications of `/.`, and we want to parenthesise them when they appear
          // as subterms of an operator with greater precedence than `/.`
          x.view.constructor == "Const" &&
          x.view.c.view.constructor == "Const_q" &&
          x.view.c.view.den != BigInt(1) &&
          parent_oi.precedence > IXO.operator_info("/.").precedence);
      return par_if(needs_par, [rec(x)], x.type);
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
            if (this._goal && fn.tag == "text") {
              fn = vtext(hcmdspan(fn.s.content, "expandable", { id: v.f.view.sym.id, anchor: this._goal?.anchor }), fn.s.visual_length);
            }
            const sid = IXT.short_id(v.f.view.sym.id);
            const pi = IXO.operator_info(sid, v.l.length > 1);

            if (sid == "subterm_selection_select")
              return this.subterm_selection2doc(v.l);
            else if (v.l.length == 0)
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
                  if (v.l.length == 0)
                    return fn;
                  else {
                    const hargs = indent([line, join(line, v.l.map(x => recwp(pi, x)))]);
                    return g([fn, hargs]);
                  }
                }
              }
            }
          }
          else {
            // fn is a function term
            const hargs = indent([line, join(line, v.l.map(x => recwp(IXO.default_(), x)))]);
            return par_if(v.l.length > 0, [fn, hargs], t.type);
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
          const def = this._goal?.definitions.find((x: IXT.Definition) => x.name == s.id);
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
          return this.sym2doc(v.c, undefined, hover_enabled, hconstructorid);
        else {
          const op_doc = this.sym2doc(v.c, undefined, hover_enabled, hconstructorid);
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
              return g([op_doc, indent([line, join(line, args)])]);
            }
          }
        }
      }
      case "Destruct":
        return g([
          kw("destruct"),
          brackets(hcat([
            this.sym2doc(v.c, undefined, hover_enabled, hconstructorid),
            text("|"),
            text(v.i.toString())])),
          indent([line,
            recwp(IXO.default_(), v.t)])]);
      case "Is_a": {
        const pi = IXO.operator_info_of_term(t);
        const lhs = recwp(pi, v.t, true);
        const rhs = this.sym2doc(v.c, undefined, hover_enabled, hconstructorid);
        return g([lhs, line, kw(pi.name), line, rhs]);
      }
      case "Tuple": return g([indent([join(hcat([text(","), line]), v.l.map(rec))])]);
      case "Field": return g([rec(v.t), text("."), linebreak, this.sym2doc(v.f, undefined, hover_enabled)])
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

    let doc: Doc = this.term2doc(t);
    if (this._with_turnstile)
      doc = g([kw("&#x22A2;"), indent([line, doc])]);
    const r = pretty(this._width, doc);
    // const end = performance.now();
    // console.log(`Prettifier time: ${(end - start) / 1000.0} sec, ${r.length} characters, width ${this._width}`);
    return r;
  }
}

/**
 * Pretty-print term `t` with `width` line size, with an optional `po` for context
 * (e.g. to look up definitions of lambdas).
 */
export function prettify(width: number, t: IXT.Term, goal?: IXT.Goal, abort_signal?: AbortSignal, with_turnstile?: boolean): string {
  try {
    return new TermFormatter(width, goal, abort_signal, with_turnstile).prettify(t);
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
