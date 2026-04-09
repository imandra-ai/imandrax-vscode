import * as IXRE from './imandrax_report_event';

export interface AppliedSymbol {
  id: string;
  type: string;
}

export interface ConstFloatView {
  constructor: "Const_float";
  v: number;
}

export interface ConstStringView {
  constructor: "Const_string";
  v: string;
}

export interface ConstZView {
  constructor: "Const_z";
  v: bigint;
}

export interface ConstQView {
  constructor: "Const_q";
  num: bigint;
  den: bigint;
}

export interface ConstRealApprox {
  constructor: "Const_real_approx";
  v: string;
}

export interface ConstUid {
  constructor: "Const_uid";
  v: string;
}

export interface ConstBool {
  constructor: "Const_bool";
  v: boolean;
}

export type ConstantView = ConstFloatView | ConstStringView | ConstZView | ConstQView | ConstRealApprox | ConstUid | ConstBool

export interface Constant {
  view: ConstantView;
}

export interface ConstView {
  constructor: "Const";
  c: Constant;
}

export interface IfView {
  constructor: "If";
  c: Term;
  t: Term;
  f: Term;
}

export interface ApplyView {
  constructor: "Apply";
  f: Term;
  l: Term[];
}

export interface VarView {
  constructor: "Var";
  id: string;
}

export interface SymView {
  constructor: "Sym";
  sym: AppliedSymbol;
}

export interface ConstructView {
  constructor: "Construct";
  c: AppliedSymbol;
  args: Term[];
  labels: string[] | undefined;
}

export interface DestructView {
  constructor: "Destruct";
  c: AppliedSymbol;
  i: bigint;
  t: Term;
}

export interface Is_aView {
  constructor: "Is_a";
  c: AppliedSymbol;
  t: Term;
}

export interface TupleView {
  constructor: "Tuple";
  l: Term[];
}

export interface FieldView {
  constructor: "Field";
  f: AppliedSymbol;
  t: Term;
}

export interface TupleFieldView {
  constructor: "Tuple_field";
  i: bigint;
  t: Term;
}

export interface RecordView {
  constructor: "Record";
  rows: [AppliedSymbol, Term][];
  rest: Term | undefined;
}

export interface CaseView {
  constructor: "Case";
  u: Term;
  cases: [AppliedSymbol, Term][];
  default: Term | undefined;
}

export interface SequenceView {
  constructor: "Sequence";
  s: [Term[], Term];
}

type TermView =
  | ConstView
  | IfView
  | ApplyView
  | VarView
  | SymView
  | ConstructView
  | DestructView
  | Is_aView
  | TupleView
  | FieldView
  | TupleFieldView
  | RecordView
  | CaseView
  | SequenceView

export interface Term {
  view: TermView;
  type: string;
}

export interface NamedTerm {
  name: string | undefined;
  term: Term;
}

export interface Sequent {
  hypotheses: NamedTerm[];
  conclusions: NamedTerm[];
}

export interface Subresult {
  subanchor: { name: string, anchor: number };
  goal: Sequent | undefined;
  subgoals: Sequent[];
  error: string | undefined;
}

export interface Report {
  events: IXRE.ReportEvent[];
}

export interface Definition {
  name: string;
  vars: string[];
  body: Term;
}

export interface SourceLocation {
  uri: string;
  from: {
    line: bigint;
    column: bigint;
  };
  to: {
    line: bigint;
    column: bigint;
  }
}

export interface Error {
  kind: string;
  message: string;
}

export interface Goal {
  name: string;
  anchor: string;
  vars: string[];
  subgoals: (Sequent | string)[];
  subresults: Subresult[][];
  errors: Error[];
  report: Report | undefined;
  definitions: Definition[];
  outdated: boolean;
  location: SourceLocation | undefined;
  byLocation: SourceLocation | undefined;
}

export interface GoalState {
  format_version: number | undefined;
  goals: Goal[];
}

export function short_id(id: string): string {
  const slash_inx = id.lastIndexOf("/");
  let r;
  if (slash_inx <= 0) // TODO: OCaml allows funky operator names that may feature `/` characters.
    r = id;
  else
    r = id.slice(0, slash_inx);
  return r;
}

export function has_multiple_children(x : Term): boolean {
  const v = x.view;
  switch (v.constructor) {
   case "Const": return v.c.view.constructor == "Const_q" && v.c.view.den != BigInt(1);
   case "If": return true;
   case "Apply": return v.l.length > 0;
   case "Var": return false;
   case "Sym": return false;
   case "Construct": return v.args.length > 0;
   case "Destruct": return true;
   case "Is_a": return true;
   case "Tuple": return true;
   case "Field": return false;
   case "Tuple_field": return false;
   case "Record": return false;
   case "Case": return true;
   case "Sequence": return true;
    default: return false;
  }
}