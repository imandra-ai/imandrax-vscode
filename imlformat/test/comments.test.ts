import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("Comment 1", () => {
  return format(`
(* This is a comment *)
let f = 1
`).then(x =>
    expect(x).toEqual(`\
(* This is a comment *)
let f = 1`))
})

test("Comment 2", () => {
  return format(`
let f = 1
(* This is a comment *)
`).then(x =>
    expect(x).toEqual(`\
let f = 1

(* This is a comment *)
`))
})

test("Docstring 1", () => {
  return format(`
(** This is a docstring *)
let f = 1
`).then(x =>
    expect(x).toEqual(`\
(** This is a docstring *)
let f = 1`))
})

test("Floating docstring", () => {
  return format(`
  let f
  =
  1

(** This is a docstring *)

    let
g = 1
`).then(x =>
    expect(x).toEqual(`\
let f = 1

(** This is a docstring *)

let g = 1`
    ))
})

test("line comments in variants", () => {
  return format(`
(* Comment 1 *)

type expr =
  | Eq of poly  (*  = 0 *)
  | Geq of poly (* >= 0 *)
  | Gt of poly  (*  > 0 *) (* a second line commment *)

(* Comment 2 *)

type something_else = int option
`).then(x =>
    expect(x).toEqual(`\
(* Comment 1 *)
type expr = Eq of poly (*  = 0 *) | Geq of poly (* >= 0 *) | Gt of poly (*  > 0 *) (* a second line commment *)

(* Comment 2 *)
type something_else = int option`
    ))
})

test("comment after if condition", () => {
  return format(`
let g x =
  if (* cond *) x > 0 (* after cond *)
  then (* then *) x
  else -x
`).then(x =>
    expect(x).toEqual(`\
let g x = if (* cond *) x > 0 (* after cond *) then (* then *) x else ~- x`))
})

test("comment in arrow type", () => {
  return format(`
type fn = int (* arg *) -> (* result *) bool
`).then(x =>
    expect(x).toEqual(`\
type fn = int (* arg *) -> (* result *) bool`))
})

test("comment banners", () => {
  return format(`
(**)
let e = 5

(***)
let f = 6

(*******************************************************)
(* Banner                                              *)
(*******************************************************)
let g = 7
`).then(x =>
    expect(x).toEqual(`\
(**)
let e = 5

(***)
let f = 6

(*******************************************************)
(* Banner                                              *)
(*******************************************************)
let g = 7`))
})

test("comment before in", () => {
  return format(`
let f x =
  let y = x + 1 (* after body *) in
  (* before in-body *)
  y * 2
`).then(x =>
    expect(x).toEqual(`\
let f x = let y = x + 1 (* after body *) in
  (* before in-body *)
  y * 2`))
})

test("doc comments on type and constructor", () => {
  return format(`
(** Doc on a type *)
type shape = Square of int (** Doc on constructor *) | Circle of int
`).then(x =>
    expect(x).toEqual(`\
(** Doc on a type *)
type shape = Square of int (** Doc on constructor *) | Circle of int`))
})

test("comments inside expressions, attributes and types", () => {
  return format(`
let k = ( (* inside parens *) 1 + 2 )

let h x = f (* arg 1 *) x

theorem (* before name *) t x = x = x [@@by (* in attribute *) auto]

eval (* expr *) (1 + 1)

type c = Blue of (* payload *) int

type 'a pair = (* left *) 'a * 'a
`).then(x =>
    expect(x).toEqual(`\
let k = (* inside parens *) 1 + 2

let h x = f (* arg 1 *) x

theorem (* before name *) t x = x = x [@@by (* in attribute *) auto]

eval ((* expr *) 1 + 1)

type c = Blue of (* payload *) int

type 'a pair = (* left *) ('a * 'a)`))
})

test("end of line comments after items", () => {
  return format(`
theorem t1 x = x = x [@@rw] (* trailing theorem *)

verify (fun x -> x = x) (* after verify *)

instance (fun x -> x > 3)
`).then(x =>
    expect(x).toEqual(`\
theorem t1 x = x = x [@@rw] (* trailing theorem *)

verify (fun x -> x = x (* after verify *))

instance (fun x -> x > 3)`))
})

test("comments in tuples and lists", () => {
  return format(`
let tup = (1, 2, 3 (* last *))

let lst = [ 1; (* two *) 2; 3 (* three *) ]

let next = 0
`).then(x =>
    expect(x).toEqual(`\
let tup = 1, 2, 3 (* last *)

let lst = [ 1; (* two *) 2; 3 (* three *) ]

let next = 0`))
})

test("comments in match cases and guards", () => {
  return format(`
let classify n =
  match n with
  | 0 -> "zero" (* trailing on case *)
  | n when (* guard *) n < 0 -> "neg"
  | _ -> "many"
`).then(x =>
    expect(x).toEqual(`\
let classify n =
  match n with
  | 0 -> "zero" (* trailing on case *)
  | n when (* guard *) n < 0 -> "neg"
  | _ -> "many"`))
})

test("comments in function bodies", () => {
  return format(`
let f x =
  (* step one *)
  let y = x + 1 in
  (* step two *)
  y * 2 (* result *)

(** Documented function *)
let h (x : int) : int =
  match x with
  | 0 -> 1 (* base *)
  | n -> (* recursive case *) n * 2
`).then(x =>
    expect(x).toEqual(`\
let f x = (* step one *)
  let y = x + 1 in
  (* step two *)
  y * 2 (* result *)

(** Documented function *)
let h (x : int) : int =
  match x with 0 -> 1 (* base *) | n -> (* recursive case *) n * 2`))
})

test("comment before record field", () => {
  return format(`
let rcd = { a = 1; (* b field *) b = 2 }
`).then(x =>
    expect(x).toEqual(`\
let rcd = { a = 1; (* b field *) b = 2; }`))
})

test("comment before end of module", () => {
  return format(`
module M = struct
  let x = 1

  (* let y = 2 *)
end
`).then(x =>
    expect(x).toEqual(`\
module M = struct
  let x = 1

  (* let y = 2 *)
end`))
})

test("docstring between two items", () => {
  return format(`
let c = ()
(** Docstring D. *)
let d = ()
`).then(x =>
    expect(x).toEqual(`\
let c = ()

(** Docstring D. *)
let d = ()`))
})

test("comment-like text in strings", () => {
  return format(`
let k = "a (* not a comment *) b"

(* a comment with "a string *) inside" *)
let l = (* nested (* comment *) *) 1
`).then(x =>
    expect(x).toEqual(`\
let k = "a (* not a comment *) b"

(* a comment with "a string *) inside" *)
let l = (* nested (* comment *) *) 1`))
})

test("comments after char literals, type variables and primed names", () => {
  return format(`
let c = '"' (* after dquote char *)
let q = '\\'' (* after escaped quote *)
type 'a t = 'a list (* after type variable *)
let f' x = x (* after primed name *)
`).then(x =>
    expect(x).toEqual(`\
let c = '"' (* after dquote char *)

let q = '\\'' (* after escaped quote *)

type 'a t = 'a list (* after type variable *)

let f' x = x (* after primed name *)`))
})

test("comment-like text in quoted strings, and literals in comments", () => {
  return format(`
let s = {|raw (* not a comment *) "|} (* real *)
let t = {id|a |} (* not a comment *) b|id} (* real *)

(* a comment with '"' and {|"|} inside *)
let d = 1
`).then(x =>
    expect(x).toEqual(`\
let s = {|raw (* not a comment *) "|} (* real *)

let t = {id|a |} (* not a comment *) b|id} (* real *)

(* a comment with '"' and {|"|} inside *)
let d = 1`))
})
