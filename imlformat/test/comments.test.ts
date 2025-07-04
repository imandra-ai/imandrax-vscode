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

let g = 1`))
})
