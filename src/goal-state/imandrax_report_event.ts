import * as IX from './imandrax_types';

export interface MessageDescription {
  constructor: "E_message";
  message: string
}

export interface TitleDescription {
  constructor: "E_title";
  title: string
}

export interface EnterWaterfallDescription {
  constructor: "E_enter_waterfall";
  vars: string[];
  goal: IX.Term;
}

export interface EnterTacticDescription {
  constructor: "E_enter_tactic";
  tactic: string;
}

export interface RWSuccessTacticDescription {
  constructor: "E_rw_success";
  rule: string;
  from: IX.Term;
  to: IX.Term;
}

export interface RWFailureTacticDescription {
  constructor: "E_rw_fail";
  rule: string;
  term: IX.Term;
  reason: string;
}

export interface InstantiationSuccessDescription {
  constructor: "E_inst_success";
  rule: string;
  term: IX.Term;
}

export interface WaterfallCheckpointDescription {
  constructor: "E_waterfall_checkpoint";
  checkpoints: IX.Sequent[];
}

export interface InductionSchemeDescription {
  constructor: "E_induction_scheme";
  scheme: IX.Term;
}

export interface AttackSubgoalDescription {
  constructor: "E_attack_subgoal";
  name: string;
  goal: IX.Sequent;
  depth: bigint;
}

export interface SimplifyDescription {
  constructor: "E_simplify_t";
  from: IX.Term;
  to: IX.Term;
}

export interface SimplifyClauseDescription {
  constructor: "E_simplify_clause";
  from: IX.Term;
  to: IX.Term[];
}

export interface ProvedBySMTDescription {
  constructor: "E_proved_by_smt";
  term: IX.Term;
  proof: string;
}

export interface RefutedBySMTDescription {
  constructor: "E_refuted_by_smt";
  term: IX.Term;
  model: string;
}

export interface FunExpansionDescription {
  constructor: "E_fun_expansion";
  from: IX.Term;
  to: IX.Term;
}


export type Description =
  | MessageDescription
  | TitleDescription
  | EnterWaterfallDescription
  | EnterTacticDescription
  | RWSuccessTacticDescription
  | RWFailureTacticDescription
  | InstantiationSuccessDescription
  | WaterfallCheckpointDescription
  | InductionSchemeDescription
  | AttackSubgoalDescription
  | SimplifyDescription
  | SimplifyClauseDescription
  | ProvedBySMTDescription
  | RefutedBySMTDescription
  | FunExpansionDescription

export interface ReportEvent {
  description: Description;
  sub_report: IX.Report | undefined;
}