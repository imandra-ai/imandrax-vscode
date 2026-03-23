import * as IX from './imandrax_types'

export enum Notation { None, Infix, Prefix }
export enum Associativity { None, Left, Right }

export class OperatorInfo {
  name: string;
  notation: Notation;
  associativity: Associativity;
  precedence: number;

  constructor(name: string,
    notation: Notation,
    associativity: Associativity,
    precedence: number) {
    this.name = name;
    this.notation = notation;
    this.associativity = associativity;
    this.precedence = precedence;
  }
}

export function operator_info(op: string, more_than_one_arg = false): OperatorInfo {
  // See also https://ocaml.org/manual/5.3/expr.html#ss:precedence-and-associativity

  // Not sure ~- is handled correctly here.

  // prefix-symbol
  if ((op.startsWith("!") || op.startsWith("?") || op.startsWith("~")) && op.length > 1 && op != "~-" && op != "~-.")
    return new OperatorInfo(op, Notation.Prefix, Associativity.None, 20);
  // . .( .[ .{ (see section 12.11)
  if (op.startsWith("#"))
    return new OperatorInfo(op, Notation.Infix, Associativity.Left, 18);
  // function application, constructor application, tag application, assert, lazy
  if (op == "assert" || op == "lazy") // rest at the bottom.
    return new OperatorInfo(op, Notation.Prefix, Associativity.Left, 17);
  // - -. (prefix)
  if ((op == "-" || op == "-." || op == "~-" || op == "~-.") && !more_than_one_arg)
    return new OperatorInfo(op, Notation.Prefix, Associativity.None, 16);
  // **… lsl lsr asr
  if (op.startsWith("**") || op == "lsl" || op == "lsr" || op == "asr")
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 15);
  // *… /… %… mod land lor lxor
  if (op.startsWith("*") || op.startsWith("/") || op.startsWith("%") || op == "mod" || op == "land" || op == "lor" || op == "lxor")
    return new OperatorInfo(op, Notation.Infix, Associativity.Left, 14);
  // +… -…
  if (op.startsWith("+") || op.startsWith("-"))
    return new OperatorInfo(op, Notation.Infix, Associativity.Left, 13);
  // ::
  if (op == "::")
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 12);
  // @… ^…
  if (op.startsWith("@") || op.startsWith("^"))
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 11);
  // =… <… >… |… &… $… !=
  if (op.startsWith("=") || op.startsWith("<") ||
    op.startsWith(">") ||
    (op.startsWith("|") && op != "||") ||
    (op.startsWith("&") && op != "&" && op != "&&") ||
    op.startsWith("$") || op == "!=")
    return new OperatorInfo(op, Notation.Infix, Associativity.Left, 10);
  // & &&
  if (op == "&" || op == "&&")
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 9);
  // or ||
  if (op == "or" || op == "||")
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 8);
  // ,	–
  if (op == ",")
    return new OperatorInfo(op, Notation.None, Associativity.None, 7);
  // <- :=
  if (op == "<-" || op == ":=")
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 6);
  // if
  if (op == "if")
    return new OperatorInfo(op, Notation.None, Associativity.None, 5);
  // ;
  if (op == ";")
    return new OperatorInfo(op, Notation.Infix, Associativity.Right, 4);
  // let match fun function try
  if (op == "let" || op == "match" || op == "fun" || op == "function" || op == "try")
    return new OperatorInfo(op, Notation.None, Associativity.None, 3);

  if (op == "implies" || op == "==>")
    return new OperatorInfo("==>", Notation.Infix, Associativity.Right, 8.3);
  if (op == "explies" || op == "<==")
    return new OperatorInfo("<==", Notation.Infix, Associativity.Left, 8.2);
  if (op == "iff" || op == "<==>")
    return new OperatorInfo("<==>", Notation.Infix, Associativity.None, 8.1);

  if (op == "List.append")
    return operator_info("@", more_than_one_arg);

  // function application, constructor application, tag application
  return new OperatorInfo(op, Notation.Prefix, Associativity.Left, 17);
}

export function default_(): OperatorInfo {
  return new OperatorInfo("", Notation.Prefix, Associativity.Left, 17);
}

export function operator_info_of_term(t: IX.Term): OperatorInfo {
  const v = t.view;
  switch (v.constructor) {
    case "If": return operator_info("if", false);
    case "Apply": {
      if (v.f.view.constructor == "Sym")
        return operator_info(IX.short_id(v.f.view.sym.id), v.l.length > 0);
      else
        return default_();
    }
    case "Tuple": return operator_info(",", false);
    case "Case": return operator_info("match", false);
    case "Construct": return operator_info(IX.short_id(v.c.id), v.args.length > 0);
    case "Const": {
      if ((v.c.view.constructor) == "Const_q" && v.c.view.den != BigInt("1"))
        return operator_info(IX.short_id("/."), true);
      else
        return default_();
    }
    case "Sym":
    case "Var":
    case "Destruct":
    case "Is_a":
    case "Field":
    case "Tuple_field":
    case "Record":
    case "Sequence":
      return default_();
  }
};

export function needs_parentheses(parent_oi: OperatorInfo, child_oi: OperatorInfo, is_left?: boolean): boolean {
  return (child_oi.name != "" && (parent_oi.precedence > child_oi.precedence ||
    (is_left !== undefined && child_oi.precedence == parent_oi.precedence) &&
    (
      (is_left && parent_oi.associativity == Associativity.Right) ||
      (is_left !== undefined && !is_left && parent_oi.associativity == Associativity.Left)))) ||
    parent_oi.notation != Notation.Infix && child_oi.notation == Notation.Infix;
}