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
let f = 1 (** This is a docstring *)`))
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
type expr = Eq of poly (*  = 0 *)  | Geq of poly (* >= 0 *)  | Gt of poly (*  > 0 *) (* a second line commment *)

(* Comment 2 *)
type something_else = int option`
    ))
})