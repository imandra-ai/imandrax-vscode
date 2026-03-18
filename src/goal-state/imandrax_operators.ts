enum Notation { None, Infix, Prefix }
enum Associativity { None, Left, Right }

export class PrecedenceInfo {
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

export function precedence_info(op: string, more_than_one_arg = false): PrecedenceInfo {
  // See also https://ocaml.org/manual/5.3/expr.html#ss:precedence-and-associativity

  // Not sure ~- is handled correctly here.

  // prefix-symbol
  if ((op.startsWith("!") || op.startsWith("?") || op.startsWith("~")) && op.length > 1 && op != "~-" && op != "~-.")
    return new PrecedenceInfo(op, Notation.Prefix, Associativity.None, 20);
  // . .( .[ .{ (see section 12.11)
  if (op.startsWith("#"))
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Left, 18);
  // function application, constructor application, tag application, assert, lazy
  if (op == "assert" || op == "lazy") // rest at the bottom.
    return new PrecedenceInfo(op, Notation.Prefix, Associativity.Left, 17);
  // - -. (prefix)
  if ((op == "-" || op == "-." || op == "~-" || op == "~-.") && !more_than_one_arg)
    return new PrecedenceInfo(op, Notation.Prefix, Associativity.None, 16);
  // **… lsl lsr asr
  if (op.startsWith("**") || op == "lsl" || op == "lsr" || op == "asr")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 15);
  // *… /… %… mod land lor lxor
  if (op.startsWith("*") || op.startsWith("/") || op.startsWith("%") || op == "mod" || op == "land" || op == "lor" || op == "lxor")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Left, 14);
  // +… -…
  if (op.startsWith("+") || op.startsWith("-"))
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Left, 13);
  // ::
  if (op == "::")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 12);
  // @… ^…
  if (op.startsWith("@") || op.startsWith("^"))
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 11);
  // =… <… >… |… &… $… !=
  if (op.startsWith("=") || op.startsWith("<") ||
    op.startsWith(">") ||
    (op.startsWith("|") && op != "||") ||
    (op.startsWith("&") && op != "&" && op != "&&") ||
    op.startsWith("$") || op == "!=")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Left, 10);
  // & &&
  if (op == "&" || op == "&&")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 9);
  // or ||
  if (op == "or" || op == "||")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 8);
  // ,	–
  if (op == ",")
    return new PrecedenceInfo(op, Notation.None, Associativity.None, 7);
  // <- :=
  if (op == "<-" || op == ":=")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 6);
  // if
  if (op == "if")
    return new PrecedenceInfo(op, Notation.None, Associativity.None, 5);
  // ;
  if (op == ";")
    return new PrecedenceInfo(op, Notation.Infix, Associativity.Right, 4);
  // let match fun function try
  if (op == "let" || op == "match" || op == "fun" || op == "function" || op == "try")
    return new PrecedenceInfo(op, Notation.None, Associativity.None, 3);

  if (op == "implies" || op == "==>")
    return new PrecedenceInfo("==>", Notation.Infix, Associativity.Right, 8.3);
  if (op == "explies" || op == "<==")
    return new PrecedenceInfo("<==", Notation.Infix, Associativity.Left, 8.2);
  if (op == "iff" || op == "<==>")
    return new PrecedenceInfo("<==>", Notation.Infix, Associativity.None, 8.1);

  // function application, constructor application, tag application
  return new PrecedenceInfo(op, Notation.Prefix, Associativity.Left, 17);
}

export function default_() : PrecedenceInfo {
  return new PrecedenceInfo("", Notation.Prefix, Associativity.Left, 17);
}