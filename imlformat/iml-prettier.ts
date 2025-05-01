import { Doc, doc, AST, AstPath, Options, Printer } from "prettier";

const { group, indent, indentIfBreak, dedent, join, ifBreak, breakParent, line, hardline, hardlineWithoutBreakParent, softline, fill } = doc.builders;


import { iml2json } from '../vendor/iml2json.bc';
import { isStringLiteralOrJsxExpression } from 'typescript';
import { assert } from 'node:console';
import { DebugAdapterNamedPipeServer, Selection } from 'vscode';
import { fileURLToPath } from 'node:url';
import { allowedNodeEnvironmentFlags } from 'node:process';
// let iml2json = require('../vendor/iml2json.bc').iml2json;

export const languages = [
	{
		extensions: ['.iml'],
		name: 'IML',
		parsers: ['iml-parse']
	}
]

type Tree = {
	top_defs: Array<string>[];
	comments: string;
};

export const parsers = {
	'iml-parse': {
		parse: (text: string, options: Options): Tree => {
			try {
				let x: Tree = {
					top_defs: JSON.parse(iml2json.parse(text)),
					comments: ""
				};
				// console.log(x.top_defs);
				return x;
			} catch (e) {
				// If parsing fails for any reason, we just throw a generic error to abort formatting.
				console.log(e);
				throw new Error("Parser error");
			}
		},
		astFormat: 'iml-ast',
		hasPragma: (_text: string): boolean => { return false; },
		locStart: (_node: Tree): number => { return 0; },
		locEnd: (_node: Tree): number => { return 0; },
		preprocess: (text: string, _options: Options): string => { return text; },
	}
}

export const printers = {
	'iml-ast': {
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

function check_undef(x) {
	assert(x instanceof Array);
	x.forEach(e => {
		assert(e !== undefined);
		if (e instanceof Array)
			check_undef(e);
	});
}

function g(x) {
	check_undef(x);
	return group(x);
}

function niy() {
	throw new Error("not implemented yet");
}

function get_source(start, end, options: Options): string {
	let from = start.loc_start.pos_cnum;
	let to = end.loc_end.pos_cnum;
	return (options.originalText as string).slice(from, to);
}

function print_longident(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Lident":
			// | Lident of string
			return node[1];
		case "Ldot":
			// | Ldot of t * string
			return fill([print_longident(args[0], options), ".", softline, args[1]]);
		case "Lapply":
			// | Lapply of t * t
			niy();
	}
}

function print_longident_loc(node: AST, options: Options): any {
	return print_longident(node.txt, options);
}

function print_constant_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pconst_integer":
			// 	| Pconst_integer of string * char option
			// 	(** Integer constants such as [3] [3l] [3L] [3n].

			//  Suffixes [[g-z][G-Z]] are accepted by the parser.
			//  Suffixes except ['l'], ['L'] and ['n'] are rejected by the typechecker
			// *)
			return g([args[0], args[1]]);
		case "Pconst_char":
			// | Pconst_char of char  (** Character such as ['c']. *)
			niy();
		case "Pconst_string":
			// | Pconst_string of string * Location.t * string option
			// 	(** Constant string such as ["constant"] or
			// 			[{delim|other constant|delim}].

			//  The location span the content of the string, without the delimiters.
			// *)
			return args[0];
		case "Pconst_float":
			// | Pconst_float of string * char option
			// 	(** Float constant such as [3.4], [2e5] or [1.4e-4].

			//  Suffixes [g-z][G-Z] are accepted by the parser.
			//  Suffixes are rejected by the typechecker.
			// *)
			niy();

		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_constant(node: AST, options: Options): any {
	return print_constant_desc(node.pconst_desc, options);
}

function print_payload(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "PStr": {
			// | PStr of structure
			return print_structure(args[0], options);
		}
		case "PSig":
			// | PSig of signature  (** [: SIG] in an attribute or an extension point *)
			niy();
		case "PTyp":
			// | PTyp of core_type  (** [: T] in an attribute or an extension point *)
			niy();
		case "PPat":
			// | PPat of pattern * expression option
			//     (** [? P]  or  [? P when E], in an attribute or an extension point *)
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_module_type_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		// module_type_desc
		case "Pmty_ident":
			// | Pmty_ident of Longident.t loc  (** [Pmty_ident(S)] represents [S] *)
			niy();
		case "Pmty_signature":
			// | Pmty_signature of signature  (** [sig ... end] *)
			niy();
		case "Pmty_functor":
			// | Pmty_functor of functor_parameter * module_type
			//     (** [functor(X : MT1) -> MT2] *)
			niy();
		case "Pmty_with":
			// | Pmty_with of module_type * with_constraint list  (** [MT with ...] *)
			niy();
		case "Pmty_typeof":
			// | Pmty_typeof of module_expr  (** [module type of ME] *)
			niy();
		case "Pmty_extension":
			// | Pmty_extension of extension  (** [[%id]] *)
			niy();
		case "Pmty_alias":
			// | Pmty_alias of Longident.t loc  (** [(module M)] *)
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_with_constraint(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		// with_constraint
		case "Pwith_type":
			// | Pwith_type of Longident.t loc * type_declaration
			//     (** [with type X.t = ...]
			//           Note: the last component of the longident must match
			//           the name of the type_declaration. *)
			niy();
		case "Pwith_module":
			// | Pwith_module of Longident.t loc * Longident.t loc
			//     (** [with module X.Y = Z] *)
			niy();
		case "Pwith_modtype":
			// | Pwith_modtype of Longident.t loc * module_type
			//     (** [with module type X.Y = Z] *)
			niy();
		case "Pwith_modtypesubst":
			// | Pwith_modtypesubst of Longident.t loc * module_type
			//     (** [with module type X.Y := sig end] *)
			niy();
		case "Pwith_typesubst":
			// | Pwith_typesubst of Longident.t loc * type_declaration
			//     (** [with type X.t := ..., same format as [Pwith_type]] *)
			niy();
		case "Pwith_modsubst":
			// | Pwith_modsubst of Longident.t loc * Longident.t loc
			//     (** [with module X.Y := Z] *)
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_module_expr_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pmod_ident":
			// | Pmod_ident of Longident.t loc  (** [X] *)
			return print_longident_loc(args[0], options);
		case "Pmod_structure":
			// | Pmod_structure of structure  (** [struct ... end] *)
			return fill([indent(["struct", hardline, print_structure(args[0], options)]), hardline, "end"]);
		case "Pmod_functor":
			// | Pmod_functor of functor_parameter * module_expr
			//     (** [functor(X : MT1) -> ME] *)
			niy()
		case "Pmod_apply":
			// | Pmod_apply of module_expr * module_expr (** [ME1(ME2)] *)
			niy()
		case "Pmod_apply_unit":
			// | Pmod_apply_unit of module_expr (** [ME1()] *)
			niy()
		case "Pmod_constraint":
			// | Pmod_constraint of module_expr * module_type  (** [(ME : MT)] *)
			niy()
		case "Pmod_unpack":
			// | Pmod_unpack of expression  (** [(val E)] *)
			niy()
		case "Pmod_extension":
			// | Pmod_extension of extension  (** [[%id]] *)
			niy()
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_string_loc(node: AST, options: Options): any {
	return node.txt;
}

function print_core_type_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		// | Ptyp_any  (** [_] *)
		// | Ptyp_var of string  (** A type variable such as ['a] *)
		// | Ptyp_arrow of arg_label * core_type * core_type
		//     (** [Ptyp_arrow(lbl, T1, T2)] represents:
		//           - [T1 -> T2]    when [lbl] is
		//                                    {{!Asttypes.arg_label.Nolabel}[Nolabel]},
		//           - [~l:T1 -> T2] when [lbl] is
		//                                    {{!Asttypes.arg_label.Labelled}[Labelled]},
		//           - [?l:T1 -> T2] when [lbl] is
		//                                    {{!Asttypes.arg_label.Optional}[Optional]}.
		//        *)
		case "Ptyp_tuple":
			// | Ptyp_tuple of core_type list
			//     (** [Ptyp_tuple([T1 ; ... ; Tn])]
			//         represents a product type [T1 * ... * Tn].

			//          Invariant: [n >= 2].
			//       *)
			return fill([join([line, "*", line], args[0].map(x => print_core_type(x, options)))]);
		case "Ptyp_constr": {
			// | Ptyp_constr of Longident.t loc * core_type list
			//     (** [Ptyp_constr(lident, l)] represents:
			//           - [tconstr]               when [l=[]],
			//           - [T tconstr]             when [l=[T]],
			//           - [(T1, ..., Tn) tconstr] when [l=[T1 ; ... ; Tn]].
			//        *)
			let r: Array<Doc> = [];
			if (args[1].length > 0)
				r.push("(");
			r = r.concat(join([",", line], args[1].map(x => print_core_type(x, options))));
			if (args[1].length > 0) {
				r.push(")");
				r.push(line);
			}
			if (r.length > 0)
				return g([r, print_longident_loc(args[0], options)]);
			else
				return g([print_longident_loc(args[0], options)]);
		}
		// | Ptyp_object of object_field list * closed_flag
		//     (** [Ptyp_object([ l1:T1; ...; ln:Tn ], flag)] represents:
		//           - [< l1:T1; ...; ln:Tn >]     when [flag] is
		//                                      {{!Asttypes.closed_flag.Closed}[Closed]},
		//           - [< l1:T1; ...; ln:Tn; .. >] when [flag] is
		//                                          {{!Asttypes.closed_flag.Open}[Open]}.
		//        *)
		// | Ptyp_class of Longident.t loc * core_type list
		//     (** [Ptyp_class(tconstr, l)] represents:
		//           - [#tconstr]               when [l=[]],
		//           - [T #tconstr]             when [l=[T]],
		//           - [(T1, ..., Tn) #tconstr] when [l=[T1 ; ... ; Tn]].
		//        *)
		// | Ptyp_alias of core_type * string loc  (** [T as 'a]. *)
		// | Ptyp_variant of row_field list * closed_flag * label list option
		//     (** [Ptyp_variant([`A;`B], flag, labels)] represents:
		//           - [[ `A|`B ]]
		//                     when [flag]   is {{!Asttypes.closed_flag.Closed}[Closed]},
		//                      and [labels] is [None],
		//           - [[> `A|`B ]]
		//                     when [flag]   is {{!Asttypes.closed_flag.Open}[Open]},
		//                      and [labels] is [None],
		//           - [[< `A|`B ]]
		//                     when [flag]   is {{!Asttypes.closed_flag.Closed}[Closed]},
		//                      and [labels] is [Some []],
		//           - [[< `A|`B > `X `Y ]]
		//                     when [flag]   is {{!Asttypes.closed_flag.Closed}[Closed]},
		//                      and [labels] is [Some ["X";"Y"]].
		//        *)
		// | Ptyp_poly of string loc list * core_type
		//     (** ['a1 ... 'an. T]

		//          Can only appear in the following context:

		//          - As the {!core_type} of a
		//         {{!pattern_desc.Ppat_constraint}[Ppat_constraint]} node corresponding
		//            to a constraint on a let-binding:
		//           {[let x : 'a1 ... 'an. T = e ...]}

		//          - Under {{!class_field_kind.Cfk_virtual}[Cfk_virtual]} for methods
		//         (not values).

		//          - As the {!core_type} of a
		//          {{!class_type_field_desc.Pctf_method}[Pctf_method]} node.

		//          - As the {!core_type} of a {{!expression_desc.Pexp_poly}[Pexp_poly]}
		//          node.

		//          - As the {{!label_declaration.pld_type}[pld_type]} field of a
		//          {!label_declaration}.

		//          - As a {!core_type} of a {{!core_type_desc.Ptyp_object}[Ptyp_object]}
		//          node.

		//          - As the {{!value_description.pval_type}[pval_type]} field of a
		//          {!value_description}.
		//        *)
		// | Ptyp_package of package_type  (** [(module S)]. *)
		// | Ptyp_open of Longident.t loc * core_type (** [M.(T)] *)
		// | Ptyp_extension of extension  (** [[%id]]. *)
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_core_type(node: AST, options: Options): any {
	// {
	//  ptyp_desc: core_type_desc;
	//  ptyp_loc: Location.t;
	//  ptyp_loc_stack: location_stack;
	//  ptyp_attributes: attributes;  (** [... [\@id1] [\@id2]] *)
	// }
	return print_core_type_desc(node.ptyp_desc, options); // TODO: attributes
}

function print_pattern_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Ppat_any":
			// | Ppat_any  (** The pattern [_]. *)
			return "_";
		case "Ppat_var":
			// | Ppat_var of string loc  (** A variable pattern such as [x] *)
			return print_string_loc(args[0], options);
		// | Ppat_alias of pattern * string loc
		//     (** An alias pattern such as [P as 'a] *)
		// | Ppat_constant of constant
		//     (** Patterns such as [1], ['a'], ["true"], [1.0], [1l], [1L], [1n] *)
		// | Ppat_interval of constant * constant
		//     (** Patterns such as ['a'..'z'].

		//          Other forms of interval are recognized by the parser
		//          but rejected by the type-checker. *)
		case "Ppat_tuple":
			// | Ppat_tuple of pattern list
			//     (** Patterns [(P1, ..., Pn)].

			//          Invariant: [n >= 2]
			//       *)
			return g(["(", softline, join([",", line], args[0].map(x => print_pattern(x, options))), softline, ")"]);;
		case "Ppat_construct":
			// | Ppat_construct of Longident.t loc * (string loc list * pattern) option
			//     (** [Ppat_construct(C, args)] represents:
			//           - [C]               when [args] is [None],
			//           - [C P]             when [args] is [Some ([], P)]
			//           - [C (P1, ..., Pn)] when [args] is
			//                                          [Some ([], Ppat_tuple [P1; ...; Pn])]
			//           - [C (type a b) P]  when [args] is [Some ([a; b], P)]
			//        *)
			return print_longident_loc(args[0], options); // TODO: args
		// | Ppat_variant of label * pattern option
		//     (** [Ppat_variant(`A, pat)] represents:
		//           - [`A]   when [pat] is [None],
		//           - [`A P] when [pat] is [Some P]
		//        *)
		// | Ppat_record of (Longident.t loc * pattern) list * closed_flag
		//     (** [Ppat_record([(l1, P1) ; ... ; (ln, Pn)], flag)] represents:
		//           - [{ l1=P1; ...; ln=Pn }]
		//                when [flag] is {{!Asttypes.closed_flag.Closed}[Closed]}
		//           - [{ l1=P1; ...; ln=Pn; _}]
		//                when [flag] is {{!Asttypes.closed_flag.Open}[Open]}

		//          Invariant: [n > 0]
		//        *)
		// | Ppat_array of pattern list  (** Pattern [[| P1; ...; Pn |]] *)
		case "Ppat_or":
			// | Ppat_or of pattern * pattern  (** Pattern [P1 | P2] *)
			return g([print_pattern(args[0], options), line, "|", line, print_pattern(args[1], options)]);
		case "Ppat_constraint":
			// | Ppat_constraint of pattern * core_type  (** Pattern [(P : T)] *)
			return g([print_pattern(args[0], options), line, ":", line, print_core_type(args[1], options)]);
		// | Ppat_type of Longident.t loc  (** Pattern [#tconst] *)
		// | Ppat_lazy of pattern  (** Pattern [lazy P] *)
		// | Ppat_unpack of string option loc
		//     (** [Ppat_unpack(s)] represents:
		//           - [(module P)] when [s] is [Some "P"]
		//           - [(module _)] when [s] is [None]

		//          Note: [(module P : S)] is represented as
		//          [Ppat_constraint(Ppat_unpack(Some "P"), Ptyp_package S)]
		//        *)
		// | Ppat_exception of pattern  (** Pattern [exception P] *)
		// | Ppat_effect of pattern * pattern (* Pattern [effect P P] *)
		// | Ppat_extension of extension  (** Pattern [[%id]] *)
		// | Ppat_open of Longident.t loc * pattern  (** Pattern [M.(P)] *)
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_pattern(node: AST, options: Options): any {
	// pattern =
	//   {
	//    ppat_desc: pattern_desc;
	//    ppat_loc: Location.t;
	//    ppat_loc_stack: location_stack;
	//    ppat_attributes: attributes;  (** [... [\@id1] [\@id2]] *)
	//   }
	return print_pattern_desc(node.ppat_desc, options); // TODO: attributes
}

function print_value_binding(node: AST, options: Options): any {
	// {
	//   pvb_pat: pattern;
	//   pvb_expr: expression;
	//   pvb_constraint: value_constraint option;
	//   pvb_attributes: attributes;
	//   pvb_loc: Location.t;
	// }(** [let pat : type_constraint = exp] *)
	return g([print_pattern(node.pvb_pat, options), line, "=", line, print_expression(node.pvb_expr, options)]);
}

function print_expression(node: AST, options: Options): any {
	// {
	// 	pexp_desc: expression_desc;
	// 	pexp_loc: Location.t;
	// 	pexp_loc_stack: location_stack;
	// 	pexp_attributes: attributes;  (** [... [\@id1] [\@id2]] *)
	//  }
	return print_expression_desc(node.pexp_desc, options); // TODO: attributes
}

function print_function_param_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pparam_val":
			// | Pparam_val of arg_label * expression option * pattern
			// (** [Pparam_val (lbl, exp0, P)] represents the parameter:
			//     - [P]
			//       when [lbl] is {{!Asttypes.arg_label.Nolabel}[Nolabel]}
			//       and [exp0] is [None]
			//     - [~l:P]
			//       when [lbl] is {{!Asttypes.arg_label.Labelled}[Labelled l]}
			//       and [exp0] is [None]
			//     - [?l:P]
			//       when [lbl] is {{!Asttypes.arg_label.Optional}[Optional l]}
			//       and [exp0] is [None]
			//     - [?l:(P = E0)]
			//       when [lbl] is {{!Asttypes.arg_label.Optional}[Optional l]}
			//       and [exp0] is [Some E0]

			//     Note: If [E0] is provided, only
			//     {{!Asttypes.arg_label.Optional}[Optional]} is allowed.
			// *)
			return print_pattern(args[2], options); // TODO: rest
		// | Pparam_newtype of string loc
		// (** [Pparam_newtype x] represents the parameter [(type x)].
		//     [x] carries the location of the identifier, whereas the [pparam_loc]
		//     on the enclosing [function_param] node is the location of the [(type x)]
		//     as a whole.

		//     Multiple parameters [(type a b c)] are represented as multiple
		//     [Pparam_newtype] nodes, let's say:

		//     {[ [ { pparam_kind = Pparam_newtype a; pparam_loc = loc1 };
		//          { pparam_kind = Pparam_newtype b; pparam_loc = loc2 };
		//          { pparam_kind = Pparam_newtype c; pparam_loc = loc3 };
		//        ]
		//     ]}

		//     Here, the first loc [loc1] is the location of [(type a b c)], and the
		//     subsequent locs [loc2] and [loc3] are the same as [loc1], except marked as
		//     ghost locations. The locations on [a], [b], [c], correspond to the
		//     variables [a], [b], and [c] in the source code.
		// *)
		case "Pparam_newtype":
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_function_param(node: AST, options: Options): any {
	return print_function_param_desc(node.pparam_desc, options);
}

function print_function_body(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pfunction_body":
			//   | Pfunction_body of expression
			return print_expression(args[0], options);
		case "Pfunction_cases":
			//   | Pfunction_cases of case list * Location.t * attributes
			//   (** In [Pfunction_cases (_, loc, attrs)], the location extends from the
			//       start of the [function] keyword to the end of the last case. The compiler
			//       will only use typechecking-related attributes from [attrs], e.g. enabling
			//       or disabling a warning.
			//   *)
			// (** See the comment on {{!expression_desc.Pexp_function}[Pexp_function]}. *)
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_module_expr_open_infos(node: AST, options: Options): any {
	return print_module_expr(node.popen_expr, options); // TODO: attributes, override
}

function print_open_declaration(node: AST, options: Options): any {
	// 	open_declaration = module_expr open_infos
	// (** Values of type [open_declaration] represents:
	//     - [open M.N]
	//     - [open M(N).O]
	//     - [open struct ... end] *)
	return print_module_expr_open_infos(node, options);
}

function print_expression_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pexp_ident":
			// | Pexp_ident of Longident.t loc
			//     (** Identifiers such as [x] and [M.x]
			//        *)
			return print_longident_loc(args[0], options);
		case "Pexp_constant":
			// | Pexp_constant of constant
			//     (** Expressions constant such as [1], ['a'], ["true"], [1.0], [1l],
			//           [1L], [1n] *)
			return print_constant(args[0], options);
		case "Pexp_construct":
			// | Pexp_construct of Longident.t loc * expression option
			// (** [Pexp_construct(C, exp)] represents:
			//      - [C]               when [exp] is [None],
			//      - [C E]             when [exp] is [Some E],
			//      - [C (E1, ..., En)] when [exp] is [Some (Pexp_tuple[E1;...;En])]
			//   *)
			return g([print_longident_loc(args[0], options)]); // TODO: args
		case "Pexp_let": {
			// | Pexp_let of rec_flag * value_binding list * expression
			//     (** [Pexp_let(flag, [(P1,E1) ; ... ; (Pn,En)], E)] represents:
			//           - [let P1 = E1 and ... and Pn = EN in E]
			//              when [flag] is {{!Asttypes.rec_flag.Nonrecursive}[Nonrecursive]},
			//           - [let rec P1 = E1 and ... and Pn = EN in E]
			//              when [flag] is {{!Asttypes.rec_flag.Recursive}[Recursive]}.
			//        *)
			let rec_flag = args[0];
			let value_bindings = args[1];
			let expr = args[2];
			let r: Array<Doc> = ["let"];
			if (rec_flag instanceof Array && rec_flag[0] == "Recursive") {
				r.push(line);
				r.push("rec");
			}

			return g([r, line, join([hardline, "and"], value_bindings.map(vb =>
				print_value_binding(vb, options)
			)),
				line, print_expression(expr, options)]);
		}
		case "Pexp_function":
			// | Pexp_function of
			//     function_param list * type_constraint option * function_body
			// (** [Pexp_function ([P1; ...; Pn], C, body)] represents any construct
			//     involving [fun] or [function], including:
			//     - [fun P1 ... Pn -> E]
			//       when [body = Pfunction_body E]
			//     - [fun P1 ... Pn -> function p1 -> e1 | ... | pm -> em]
			//       when [body = Pfunction_cases [ p1 -> e1; ...; pm -> em ]]

			//     [C] represents a type constraint or coercion placed immediately before the
			//     arrow, e.g. [fun P1 ... Pn : ty -> ...] when [C = Some (Pconstraint ty)].

			//     A function must have parameters. [Pexp_function (params, _, body)] must
			//     have non-empty [params] or a [Pfunction_cases _] body.
			// *)
			return g(["fun", line, join(line, args[0].map(n => print_function_param(n, options))), line, print_function_body(args[2], options)]);

		case "Pexp_apply": {
			// | Pexp_apply of expression * (arg_label * expression) list
			//     (** [Pexp_apply(E0, [(l1, E1) ; ... ; (ln, En)])]
			//           represents [E0 ~l1:E1 ... ~ln:En]

			//           [li] can be
			//             {{!Asttypes.arg_label.Nolabel}[Nolabel]}   (non labeled argument),
			//             {{!Asttypes.arg_label.Labelled}[Labelled]} (labelled arguments) or
			//             {{!Asttypes.arg_label.Optional}[Optional]} (optional argument).

			//          Invariant: [n > 0]
			//        *)
			function is_infix(obj: any, children: any): boolean {
				// Can we figure out whether an operator was used in infix fashion from the source text?
				if (children instanceof Array && children.length > 0) {
					let c2 = children[0]
					const infix_ops = ['=', '==', '!=',
						'+', '-', '*', '/', '<', '<=', '>', '>=',
						'+.', '-.', '*.', '/.', '<.', '<=.', '>.', '>=.',
						'&&', '||'];
					return obj.pexp_desc[1].txt[0] == "Lident" &&
						infix_ops.find(x => x == obj.pexp_desc[1].txt[1]) !== undefined &&
						c2 instanceof Array && c2.length == 2;
				}
				return false;
			}
			function is_zconst(obj: any, children: any): boolean {
				if (obj.pexp_desc[0] == "Pexp_ident" && children.length == 1) {
					let id = obj.pexp_desc[1].txt;
					if (
						id instanceof Array && id.length == 3 &&
						id[0] == "Ldot" && id[1].length == 2 &&
						id[1][0] == "Lident" && id[1][1] == "Z" &&
						id[2] == "of_nativeint") {
						let c = children[0][1];
						return c.pexp_desc[0] == "Pexp_constant";
					}
				}
				return false;
			}
			function is_qconst(obj: any, children: any): boolean {
				if (obj.pexp_desc[0] == "Pexp_ident" && children.length == 1) {
					let id = obj.pexp_desc[1].txt;
					if (
						id instanceof Array && id.length == 3 &&
						id[0] == "Ldot" && id[1].length == 2 &&
						id[1][0] == "Lident" && id[1][1] == "Q" &&
						id[2] == "of_string") {
						let c = children[0][1];
						return c.pexp_desc[0] == "Pexp_constant";
					}
				}
				return false;
			}

			let obj = args[0];
			let children = args[1];
			if (is_infix(obj, children)) {
				return g(["(", softline,
					print_expression(children[0][1], options), line,
					print_expression(args[0], options), line, // TODO: check
					print_expression(children[1][1], options), softline,
					")"]);
			}
			else if (is_zconst(obj, children) || is_qconst(obj, children)) {
				// Keep the source formatting so as not to break integer/real constants.
				let cloc = children[0][1].pexp_loc;
				return get_source(cloc, cloc, options);
			}
			else
				return g(["(", softline,
					print_expression(args[0], options), line,
					join(line, args[1].map(n => print_expression(n[1], options))), softline, ")"]);
		}
		case "Pexp_match":
			// | Pexp_match of expression * case list
			//     (** [match E0 with P1 -> E1 | ... | Pn -> En] *)
			let cs = join([line, "|", " "], args[1].map(x => {
				return g([print_pattern(x.pc_lhs, options), " ", "->", line, print_expression(x.pc_rhs, options)]);
			}));
			return g(["match", line, print_expression(args[0], options), line, "with", line,
				cs]);
		// | Pexp_try of expression * case list
		//     (** [try E0 with P1 -> E1 | ... | Pn -> En] *)
		case "Pexp_tuple":
			// | Pexp_tuple of expression list
			//     (** Expressions [(E1, ..., En)]

			//          Invariant: [n >= 2]
			//       *)
			return g(["(", softline, join([",", line], args[0].map(x => print_expression(x, options))), softline, ")"]);;
		// | Pexp_construct of Longident.t loc * expression option
		//     (** [Pexp_construct(C, exp)] represents:
		//          - [C]               when [exp] is [None],
		//          - [C E]             when [exp] is [Some E],
		//          - [C (E1, ..., En)] when [exp] is [Some (Pexp_tuple[E1;...;En])]
		//       *)
		// | Pexp_variant of label * expression option
		//     (** [Pexp_variant(`A, exp)] represents
		//           - [`A]   when [exp] is [None]
		//           - [`A E] when [exp] is [Some E]
		//        *)
		// | Pexp_record of (Longident.t loc * expression) list * expression option
		//     (** [Pexp_record([(l1,P1) ; ... ; (ln,Pn)], exp0)] represents
		//           - [{ l1=P1; ...; ln=Pn }]         when [exp0] is [None]
		//           - [{ E0 with l1=P1; ...; ln=Pn }] when [exp0] is [Some E0]

		//          Invariant: [n > 0]
		//        *)
		case "Pexp_field":
			// | Pexp_field of expression * Longident.t loc  (** [E.l] *)
			return g([print_expression(args[0], options), ".", softline, print_longident_loc(args[1], options)]);
		// | Pexp_setfield of expression * Longident.t loc * expression
		//     (** [E1.l <- E2] *)
		// | Pexp_array of expression list  (** [[| E1; ...; En |]] *)
		case "Pexp_ifthenelse":
			// | Pexp_ifthenelse of expression * expression * expression option
			//     (** [if E1 then E2 else E3] *)
			return g(["if", line, print_expression(args[0], options), line, "then", print_expression(args[1], options), line, "else", line, print_expression(args[2], options)]);
		// | Pexp_sequence of expression * expression  (** [E1; E2] *)
		// | Pexp_while of expression * expression  (** [while E1 do E2 done] *)
		// | Pexp_for of pattern * expression * expression * direction_flag * expression
		//     (** [Pexp_for(i, E1, E2, direction, E3)] represents:
		//           - [for i = E1 to E2 do E3 done]
		//                when [direction] is {{!Asttypes.direction_flag.Upto}[Upto]}
		//           - [for i = E1 downto E2 do E3 done]
		//                when [direction] is {{!Asttypes.direction_flag.Downto}[Downto]}
		//        *)
		// | Pexp_constraint of expression * core_type  (** [(E : T)] *)
		// | Pexp_coerce of expression * core_type option * core_type
		//     (** [Pexp_coerce(E, from, T)] represents
		//           - [(E :> T)]      when [from] is [None],
		//           - [(E : T0 :> T)] when [from] is [Some T0].
		//        *)
		// | Pexp_send of expression * label loc  (** [E # m] *)
		// | Pexp_new of Longident.t loc  (** [new M.c] *)
		// | Pexp_setinstvar of label loc * expression  (** [x <- 2] *)
		// | Pexp_override of (label loc * expression) list
		//     (** [{< x1 = E1; ...; xn = En >}] *)
		// | Pexp_letmodule of string option loc * module_expr * expression
		//     (** [let module M = ME in E] *)
		// | Pexp_letexception of extension_constructor * expression
		//     (** [let exception C in E] *)
		// | Pexp_assert of expression
		//     (** [assert E].

		//          Note: [assert false] is treated in a special way by the
		//          type-checker. *)
		// | Pexp_lazy of expression  (** [lazy E] *)
		// | Pexp_poly of expression * core_type option
		//     (** Used for method bodies.

		//          Can only be used as the expression under
		//          {{!class_field_kind.Cfk_concrete}[Cfk_concrete]} for methods (not
		//          values). *)
		// | Pexp_object of class_structure  (** [object ... end] *)
		// | Pexp_newtype of string loc * expression  (** [fun (type t) -> E] *)
		// | Pexp_pack of module_expr
		//     (** [(module ME)].

		//          [(module ME : S)] is represented as
		//          [Pexp_constraint(Pexp_pack ME, Ptyp_package S)] *)
		case "Pexp_open":
			// | Pexp_open of open_declaration * expression
			//     (** - [M.(E)]
			//           - [let open M in E]
			//           - [let open! M in E] *)
			return g(["let", line, "open", line,
				print_open_declaration(args[0], options), line, "in", line,
				print_expression(args[1], options)]);
		// | Pexp_letop of letop
		//     (** - [let* P = E0 in E1]
		//           - [let* P0 = E00 and* P1 = E01 in E1] *)
		// | Pexp_extension of extension  (** [[%id]] *)
		// | Pexp_unreachable  (** [.] *)
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_constructor_arguments(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pcstr_tuple":
			// | Pcstr_tuple of core_type list
			return g([join([line, "*", line], args[0].map(x => print_core_type(x, options)))]);
		case "Pcstr_record":
			// | Pcstr_record of label_declaration list
			//     (** Values of type {!constructor_declaration}
			//   represents the constructor arguments of:
			// - [C of T1 * ... * Tn]     when [res = None],
			//                             and [args = Pcstr_tuple [T1; ... ; Tn]],
			// - [C: T0]                  when [res = Some T0],
			//                             and [args = Pcstr_tuple []],
			// - [C: T1 * ... * Tn -> T0] when [res = Some T0],
			//                             and [args = Pcstr_tuple [T1; ... ; Tn]],
			// - [C of {...}]             when [res = None],
			//                             and [args = Pcstr_record [...]],
			// - [C: {...} -> T0]         when [res = Some T0],
			//                             and [args = Pcstr_record [...]].
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_constructor_declaration(node: AST, options: Options): any {
	// {
	//  pcd_name: string loc;
	//  pcd_vars: string loc list;
	//  pcd_args: constructor_arguments;
	//  pcd_res: core_type option;
	//  pcd_loc: Location.t;
	//  pcd_attributes: attributes;  (** [C of ... [\@id1] [\@id2]] *)
	// }
	return print_constructor_arguments(node.pcd_args, options); // TODO: rest
}

function print_label_declaration(node: AST, options: Options): any {
	// {
	// 	pld_name: string loc;
	// 	pld_mutable: mutable_flag;
	// 	pld_type: core_type;
	// 	pld_loc: Location.t;
	// 	pld_attributes: attributes;  (** [l : T [\@id1] [\@id2]] *)
	//  }
	return print_core_type(node.pld_type, options);
}

function print_type_kind(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Ptype_abstract":
			// | Ptype_abstract
			return ""; // TODO: this can't be right.
		case "Ptype_variant":
			// | Ptype_variant of constructor_declaration list
			return g([line, ifBreak("| ", ""), join([line, "| "], args[0].map(x => {
				if (x.pcd_args[1].length == 0)
					return x.pcd_name.txt;
				else
					return fill([x.pcd_name.txt, line, "of", line, print_constructor_declaration(x, options)]);
			}
			))]);
		case "Ptype_record":
			// | Ptype_record of label_declaration list  (** Invariant: non-empty list *)
			return fill(join([";", hardline], args[0].map(x => {
				return fill([x.pld_name.txt, line, ":", line, print_label_declaration(x, options)]);
			})));
		case "Ptype_open":
			// | Ptype_open
			niy();
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_type_declaration(node: AST, options: Options): any {
	// {
	// 	ptype_name: string loc;
	// 	ptype_params: (core_type * (variance * injectivity)) list;
	// 	 (** [('a1,...'an) t] *)
	// 	ptype_cstrs: (core_type * core_type * Location.t) list;
	// 	 (** [... constraint T1=T1'  ... constraint Tn=Tn'] *)
	// 	ptype_kind: type_kind;
	// 	ptype_private: private_flag;  (** for [= private ...] *)
	// 	ptype_manifest: core_type option;  (** represents [= T] *)
	// 	ptype_attributes: attributes;  (** [... [\@\@id1] [\@\@id2]] *)
	// 	ptype_loc: Location.t;
	//  }
	return fill([node.ptype_name.txt, line, "=", indent([print_type_kind(node.ptype_kind, options)])]); // TODO: rest
}

function print_module_expr(node: AST, options: Options): any {
	// {
	// 	pmod_desc: module_expr_desc;
	// 	pmod_loc: Location.t;
	// 	pmod_attributes: attributes;  (** [... [\@id1] [\@id2]] *)
	//  }
	return print_module_expr_desc(node.pmod_desc, options);
}

function print_module_binding(node: AST, options: Options): any {
	// {
	// 	pmb_name: string option loc;
	// 	pmb_expr: module_expr;
	// 	pmb_attributes: attributes;
	// 	pmb_loc: Location.t;
	//  }
	return print_module_expr(node.pmb_expr, options); // TODO: rest
}

function print_attribute(node: AST, options: Options): any {
	// {
	//   attr_name : string loc;
	//   attr_payload : payload;
	//   attr_loc : Location.t;
	// }
	switch (node.attr_name.txt) {
		case "ocaml.text":
			return g(["(**", print_payload(node.attr_payload, options), line, "*)"]);
		case "import": {
			// We need a tuple without parentheses here.
			let mod_file = node.attr_payload[1][0].pstr_desc[1].pexp_desc[1];
			return fill(["[@@@import", line, print_expression(mod_file[0], options), ",", line, "\"", print_expression(mod_file[1], options), "\"", "]"]);
		}
		default:
			return g(["[@@@", node.attr_name.txt, line, print_payload(node.attr_payload, options), "]"]);
	}
}

function has_attribute(attrs, x): boolean {
	return attrs.find(a => a.attr_name.txt == x);
}

function print_structure_item_desc(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Pstr_eval": {
			// | Pstr_eval of expression * attributes  (** [E] *)
			if (args.length > 1 && has_attribute(args[1], "imandra_eval"))
				return fill(["eval", line, print_expression(args[0], options)]);
			else
				return print_expression(args[0], options); // TODO: attributes
		}
		case "Pstr_value":
			// | Pstr_value of rec_flag * value_binding list
			// 		(** [Pstr_value(rec, [(P1, E1 ; ... ; (Pn, En))])] represents:
			// 					- [let P1 = E1 and ... and Pn = EN]
			// 							when [rec] is {{!Asttypes.rec_flag.Nonrecursive}[Nonrecursive]},
			// 					- [let rec P1 = E1 and ... and Pn = EN ]
			// 							when [rec] is {{!Asttypes.rec_flag.Recursive}[Recursive]}.
			// 			*)
			let r: Array<Doc> = [];
			let is_instance = false;
			if (args[1][0].pvb_attributes.length > 0) {
				let attrs = args[1][0].pvb_attributes;
				if (has_attribute(attrs, "imandra_theorem")) {
					// Could be a theorem or a lemma; search backwards for the keyword.
					let cloc = args[1][0].pvb_loc;
					let src = options.originalText as string;
					let from = cloc.loc_start.pos_cnum - 1;
					const whitespace_chars = [" ", "\t", "\n", "\r"];
					while (from > 0 && whitespace_chars.find(x => x == src[from])) {
						from--;
					}
					from--;
					while (from > 0 && !whitespace_chars.find(x => x == src[from])) {
						from--;
					}
					if (from >= 0 && src.slice(from + 1, from + 6) == "lemma")
						r.push("lemma")
					else
						r.push("theorem")
				}
				if (has_attribute(attrs, "imandra_instance")) {
					r.push("instance");
					is_instance = true;
				}
			}
			else
				r.push("let");
			if (args[0] instanceof Array && args[0][0] == "Recursive") {
				r.push(line);
				r.push("rec");
			}
			if (is_instance) {
				// Do this for all lambdas?
				let pvb = args[1][0];
				return g([r, line, "(", softline, "fun", line,
					join(line, pvb.pvb_expr.pexp_desc[1].map(x => print_function_param(x, options))), line,
					"->", line,
					print_function_body(pvb.pvb_expr.pexp_desc[3], options), softline, ")"]);
			}
			else if (args[1].length > 0) {
				let pvb = args[1][0];
				if (pvb.pvb_expr.pexp_desc[0] == "Pexp_function") {
					// For function definitions we want to hoist the arguments
					return g([r, line, print_pattern(pvb.pvb_pat, options), line,
						join(line, pvb.pvb_expr.pexp_desc[1].map(x => print_function_param(x, options))), line,
						"=", line, print_function_body(pvb.pvb_expr.pexp_desc[3], options)]);
				}
			}
			// Generic version
			return g([r, line, join([line, "and", line], args[1].map(x => print_value_binding(x, options)))]);
		case "Pstr_primitive": // TODO
			// | Pstr_primitive of value_description
			// 		(** - [val x: T]
			// 					- [external x: T = "s1" ... "sn" ]*)
			niy()
		case "Pstr_type": {
			// | Pstr_type of rec_flag * type_declaration list
			// 		(** [type t1 = ... and ... and tn = ...] *)
			return fill(["type", line, join([line, "and", line], args[1].map(td => print_type_declaration(td, options)))]);
		}
		case "Pstr_typext":
			// | Pstr_typext of type_extension  (** [type t1 += ...] *)
			niy()
		case "Pstr_exception":
			// | Pstr_exception of type_exception
			// 		(** - [exception C of T]
			// 					- [exception C = M.X] *)
			niy()
		case "Pstr_module":
			// | Pstr_module of module_binding  (** [module X = ME] *)
			return fill(["module", line, args[0].pmb_name.txt, line, "=", line, print_module_binding(args[0], options)]);
		case "Pstr_recmodule":
			// | Pstr_recmodule of module_binding list
			// 		(** [module rec X1 = ME1 and ... and Xn = MEn] *)
			niy()
		case "Pstr_modtype":
			// | Pstr_modtype of module_type_declaration  (** [module type S = MT] *)
			niy()
		case "Pstr_open":
			// | Pstr_open of open_declaration  (** [open X] *)
			niy()
		case "Pstr_class":
			// | Pstr_class of class_declaration list
			// 		(** [class c1 = ... and ... and cn = ...] *)
			niy()
		case "Pstr_class_type":
			// | Pstr_class_type of class_type_declaration list
			// 		(** [class type ct1 = ... and ... and ctn = ...] *)
			niy()
		case "Pstr_include":
			// | Pstr_include of include_declaration  (** [include ME] *)
			niy()
		case "Pstr_attribute":
			// | Pstr_attribute of attribute  (** [[\@\@\@id]] *)
			return print_attribute(args[0], options);
		case "Pstr_extension":
			// | Pstr_extension of extension * attributes  (** [[%%id]] *)
			niy()
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print_structure_item(node: AST, options: Options): any {
	return print_structure_item_desc(node.pstr_desc, options);
}

function print_structure(node: AST, options: Options): any {
	return join(hardline, node.map(x => print_structure_item(x, options)));
}

function print_toplevel_directive(node: AST, options: Options): any {
	// {
	//   pdir_name: string loc;
	//   pdir_arg: directive_argument option;
	//   pdir_loc: Location.t;
	// }
	niy();
}

function print_toplevel_phrase(node: AST, options: Options): any {
	let constructor = node[0];
	let args = node.slice(1);
	switch (constructor) {
		case "Ptop_def": {
			try {
				return print_structure(args[0], options);
			}
			catch (e) {
				console.log(e);
				// If something fails, just keep the original text.
				switch (args[0].length) {
					case 0: { throw e; }
					case 1: {
						let loc = args[0][0].pstr_loc;
						return get_source(loc, loc, options);
					}
					default: {
						let loc_start = args[0][0].pstr_loc;
						let loc_end = args[0][-1].pstr_loc;
						return get_source(loc_start, loc_end, options);
					}
				}
			}
		}
		case "Ptop_dir": {
			try {
				return print_toplevel_directive(args[0], options);
			}
			catch (e) {
				// If something fails, just keep the original text.
				get_source(args[0].pdir_loc, args[0].pdir_loc, options);
			}
		}
		default:
			throw new Error(`Unexpected node type: ${constructor}`);
	}
}

function print(path: AstPath<Tree>, options: Options, print: (path: AstPath<Tree>) => Doc) {
	return join([hardlineWithoutBreakParent, hardlineWithoutBreakParent], path.node.top_defs.map(n => {
		return [print_toplevel_phrase(n, options)];
	}
	));
}