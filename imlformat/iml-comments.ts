// Comments for the IML prettier plugin.
//
// The parser drops comments, so we lex them from the source text ourselves. Every
// comment is printed exactly once, in source order: either as a leading comment of
// the first node that starts after it, or as a trailing comment of a node that it
// follows on the same line. Doc comments that the parser turned into attributes are
// printed with their attributes instead.

import { Doc, doc, Options } from "prettier";

const { line, hardline } = doc.builders;

export interface Position {
  pos_fname: string;
  pos_cnum: number;
  pos_lnum: number;
  pos_bol: number;
}

export interface Location {
  loc_start: Position;
  loc_ghost: boolean;
  loc_end: Position;
}

interface Comment {
  start: number;
  end: number;
}

interface CommentState {
  list: Comment[];
  next: number;
  doc_positions: Map<number, number>;
}

const char_literal_re = /'(?:\\(?:[\\'"ntbr ]|[0-9]{3}|x[0-9a-fA-F]{2}|o[0-3][0-7]{2}|u\{[0-9a-fA-F]+\})|[^\\'\n])'/y;
const quoted_string_re = /\{([a-z_]*)\|/y;

function is_ident_char(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_']/.test(c);
}

// Returns the position just after the string, char or quoted string literal at
// [i], or [i] itself if there is none.
function skip_literal(src: string, i: number): number {
  if (src[i] == '"') {
    i++;
    while (i < src.length && src[i] != '"')
      i += src[i] == '\\' ? 2 : 1;
    return i + 1;
  }
  if (src[i] == "'" && !is_ident_char(src[i - 1])) {
    char_literal_re.lastIndex = i;
    const m = char_literal_re.exec(src);
    return m ? i + m[0].length : i;
  }
  if (src[i] == '{') {
    quoted_string_re.lastIndex = i;
    const m = quoted_string_re.exec(src);
    if (m) {
      const close = src.indexOf("|" + m[1] + "}", i + m[0].length);
      return close == -1 ? src.length : close + m[1].length + 2;
    }
  }
  return i;
}

// Returns the position just after the (possibly nested) comment starting at [i].
function skip_comment(src: string, i: number): number {
  let depth = 0;
  while (i < src.length) {
    if (src.startsWith("(*", i)) {
      depth++;
      i += 2;
    }
    else if (src.startsWith("*)", i)) {
      depth--;
      i += 2;
      if (depth == 0)
        return i;
    }
    else {
      const j = skip_literal(src, i);
      i = j > i ? j : i + 1;
    }
  }
  return src.length;
}

function lex_comments(src: string): Comment[] {
  const r: Comment[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("(*", i)) {
      const end = skip_comment(src, i);
      r.push({ start: i, end: end });
      i = end;
    }
    else {
      const j = skip_literal(src, i);
      i = j > i ? j : i + 1;
    }
  }
  return r;
}

// Counts the doc comments that appear in the AST as attributes, by start position.
// A doc comment between two items is attached to both of them.
function collect_doc_positions(x: any, acc: Map<number, number>) {
  if (x instanceof Array)
    x.forEach(e => collect_doc_positions(e, acc));
  else if (x instanceof Object) {
    const name = x.attr_name?.txt;
    if ((name == "ocaml.doc" || name == "ocaml.text") && x.attr_loc && !x.attr_loc.loc_ghost) {
      const pos = x.attr_loc.loc_start.pos_cnum;
      acc.set(pos, (acc.get(pos) ?? 0) + 1);
    }
    Object.values(x).forEach(e => collect_doc_positions(e, acc));
  }
}

function comment_state(options: Options): CommentState {
  return options.iml_comments as CommentState;
}

function comment_text(c: Comment, options: Options): string {
  return (options.originalText as string).slice(c.start, c.end);
}

function followed_by_newline(pos: number, options: Options): boolean {
  const m = /^[ \t]*(\r?\n)?/.exec((options.originalText as string).slice(pos));
  return m?.[1] !== undefined;
}

function preceded_by_newline(pos: number, options: Options): boolean {
  return /\n[ \t]*$/.test((options.originalText as string).slice(0, pos));
}

export function is_real_loc(loc: Location | undefined): boolean {
  return !!loc && !loc.loc_ghost && loc.loc_start.pos_cnum >= 0;
}

// Sets up the comments of the source for printing [top_defs].
export function init_comments(top_defs: any, options: Options) {
  const src = options.originalText as string;
  const doc_positions = new Map<number, number>();
  collect_doc_positions(top_defs, doc_positions);
  const state: CommentState = {
    list: lex_comments(src).filter(c => !doc_positions.has(c.start)),
    next: 0,
    doc_positions: doc_positions
  };
  options.iml_comments = state;
}

// The number of items that the doc comment starting at [pos] is attached to.
export function doc_comment_count(pos: number, options: Options): number {
  return comment_state(options).doc_positions.get(pos) ?? 0;
}

// Prints the pending comments that end before [pos].
function comments_before(pos: number, options: Options): Doc[] {
  const st = comment_state(options);
  const r: Doc[] = [];
  while (st.next < st.list.length && st.list[st.next].end <= pos) {
    const c = st.list[st.next++];
    r.push(comment_text(c, options), followed_by_newline(c.end, options) ? hardline : line);
  }
  return r;
}

// Leading comments of a node at [cur].
export function comments(cur: Location, options: Options): Doc[] {
  if (!is_real_loc(cur))
    return [];
  return comments_before(cur.loc_start.pos_cnum, options);
}

// Comments that follow a node at [cur] on the same line, with only whitespace in
// between.
export function trailing_comments(cur: Location, options: Options): Doc[] {
  if (!is_real_loc(cur))
    return [];
  const st = comment_state(options);
  const src = options.originalText as string;
  const r: Doc[] = [];
  let pos = cur.loc_end.pos_cnum;
  while (st.next < st.list.length) {
    const c = st.list[st.next];
    if (c.start < pos || !/^[ \t]*$/.test(src.slice(pos, c.start)))
      break;
    r.push(" ", comment_text(c, options));
    pos = c.end;
    st.next++;
  }
  return r;
}

// Comments inside [cur] that no node inside it has picked up, followed by its
// trailing comments.
export function remaining_comments(cur: Location, options: Options): Doc[] {
  if (!is_real_loc(cur))
    return [];
  const st = comment_state(options);
  const r: Doc[] = [];
  while (st.next < st.list.length && st.list[st.next].end <= cur.loc_end.pos_cnum) {
    const c = st.list[st.next++];
    r.push(preceded_by_newline(c.start, options) ? hardline : " ", comment_text(c, options));
  }
  return [...r, ...trailing_comments(cur, options)];
}

// Comments before the closing keyword of a block that ends at [cur], each on its
// own line.
export function closing_comments(cur: Location, options: Options): Doc[] {
  if (!is_real_loc(cur))
    return [];
  const st = comment_state(options);
  const r: Doc[] = [];
  while (st.next < st.list.length && st.list[st.next].end <= cur.loc_end.pos_cnum)
    r.push(hardline, hardline, comment_text(st.list[st.next++], options));
  return r;
}

// Comments after the last item, each on its own line, keeping blank lines between
// them.
export function leftover_comments(options: Options): Doc[] {
  const st = comment_state(options);
  const src = options.originalText as string;
  const r: Doc[] = [];
  st.list.slice(st.next).forEach((c, i, cs) => {
    if (i > 0)
      r.push(/\n[ \t]*\r?\n/.test(src.slice(cs[i - 1].end, c.start)) ? [hardline, hardline] : hardline);
    r.push(comment_text(c, options));
  });
  st.next = st.list.length;
  return r;
}
