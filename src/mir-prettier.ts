import { Mutex } from 'async-mutex';

import { Doc, doc, AST, AstPath, Options } from "prettier";

const { group, indent, join, line, ifBreak, softline } = doc.builders;

import * as api from "imandrax-api/types";

export var requests = new Map<number, api.Mir_Term>();
export var requests_lock = new Mutex();

export const languages = [
  {
    extensions: ['.mir'],
    name: 'MIR',
    parsers: ['mir-parse']
  }
]

export const parsers = {
  'mir-parse': {
    parse: (text, options): AST => {
      // We want to format MIR terms, not arbitary strings, so `text` just holds
      // the request id that lets us get the term out of `requests`.

      const id = Number.parseInt(text);
      requests_lock.acquire()
      let r: any = requests.get(id);
      requests.delete(id);
      requests_lock.release();

      r.comments = "";
      return r
    },
    astFormat: 'imandrax-ast',
    hasPragma: (text): boolean => { return false; },
    locStart: (node): number => { return 0; },
    locEnd: (node): number => { return 0; },
    preprocess: (text, options): string => { return text; },
  }
}

export const printers = {
  'imandrax-ast': {
    print,
    // embed,
    // preprocess,
    // getVisitorKeys,
    // insertPragma,
    // canAttachComment,
    // isBlockComment,
    // printComment,
    // getCommentChildNodes,
    // handleComments: {
    //   ownLine,
    //   endOfLine,
    //   remaining,
    // },
  }
}

function printMIR(node: api.Mir_Term, options: Options) {
  const v: api.Mir_Term_view<api.Mir_Term, api.Mir_Type> = node.view;

  if (v instanceof api.Mir_Term_view_Apply) {
    return group([
      (v.l.length > 0) ? "(" : "",
      printMIR(v.f, options),
      (v.l.length > 0) ? " " : "",
      indent([softline, join(" ", v.l.map(e => printMIR(e, options)))]),
      (v.l.length > 0) ? ")" : "",
      softline,
    ]);
  }
  else if (v instanceof api.Mir_Term_view_Sym) {
    let r = v.arg.sym.id.name;
    if (v.arg.sym.id.name.startsWith("*"))
      r = " " + r;
    return r
  }
  else if (v instanceof api.Mir_Term_view_Construct) {
    return group([
      (v.args.length > 0) ? "(" : "",
      indent([softline, v.c.sym.id.name,
        (v.args.length > 0) ? " " : "",
        join(softline, join(" ", v.args.map(e => printMIR(e, options))))
      ]),
      (v.args.length > 0) ? ")" : "",
      softline,
    ]);
  }
  else if (v instanceof api.Mir_Term_view_Const) {
    if (v.arg instanceof api.Const_Const_q && v.arg.arg instanceof Array && v.arg.arg.length == 2) {
      return (v.arg.arg[0] / v.arg.arg[1]).toString();
    }
    else if (v.arg instanceof api.Const_Const_z) {
      return v.arg.arg.toString();
    }
  }
  else if (v instanceof api.Mir_Term_view_Tuple_field) {
    return group([printMIR(v.t, options), ".", v.i.toString()]);
  }
  else if (v instanceof api.Mir_Term_view_Is_a) {
    return group(["is-a", "[", v.c.sym.id.name, "]", "(", printMIR(v.t, options), ")"]);
  }

  throw new Error(`Unknown node type: ${node.view}`);
}

function print(path: AstPath<api.Mir_Term>, options: Options, _print: (path: AstPath<api.Mir_Term>) => Doc) {
  const node: api.Mir_Term = path.node;
  return printMIR(node, options);
}