import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("constructor with tuple argument and alias", () => {
  return format(`
type tree = Leaf | Node of tree * int * tree

let rec insert x = function
  | Leaf -> Node (Leaf, x, Leaf)
  | Node (l, y, r) as t -> if x < y then Node (insert x l, y, r) else t
`).then(x =>
    expect(x).toEqual(`\
type tree = Leaf | Node of tree * int * tree

let rec insert x =
  function
  | Leaf -> Node (Leaf, x, Leaf)
  | Node (l, y, r) as t -> if x < y then Node (insert x l, y, r) else t`))
})

test("constructor with cons argument", () => {
  return format(`
let head o = match o with Some (x :: _) -> x | _ -> 0
`).then(x =>
    expect(x).toEqual(`\
let head o = match o with Some (x::_) -> x | _ -> 0`))
})

test("constructor with tuple argument", () => {
  return format(`
let sum o = match o with Some (x, y) -> x + y | None -> 0
`).then(x =>
    expect(x).toEqual(`\
let sum o = match o with Some (x, y) -> x + y | None -> 0`))
})

test("constructor with negative constant", () => {
  return format(`
let q x = match x with Some (-1) -> 0 | _ -> 1
`).then(x =>
    expect(x).toEqual(`\
let q x = match x with Some (-1) -> 0 | _ -> 1`))
})

test("list patterns", () => {
  return format(`
let two l = match l with [a; b] -> a + b | _ -> 0
`).then(x =>
    expect(x).toEqual(`\
let two l = match l with [a; b] -> a + b | _ -> 0`))
})

test("list of tuples patterns", () => {
  return format(`
let firsts l = match l with [(a, _); (b, _)] -> [a; b] | _ -> []
`).then(x =>
    expect(x).toEqual(`\
let firsts l = match l with [a, _; b, _] -> [ a; b ] | _ -> []`))
})

test("cons of tuple and alias patterns", () => {
  return format(`
let g = function (a, b) :: rest -> a | (x as y) :: _ -> y | [] -> 0
`).then(x =>
    expect(x).toEqual(`\
let g =
  function
  | (a, b)::rest -> a
  | (x as y)::_ -> y
  | [] -> 0`))
})

test("when guards", () => {
  return format(`
let sign n =
  match n with
  | n when n < 0 -> "neg"
  | 0 -> "zero"
  | _ -> "pos"
`).then(x =>
    expect(x).toEqual(`\
let sign n = match n with n when n < 0 -> "neg" | 0 -> "zero" | _ -> "pos"`))
})

test("when guards in function cases", () => {
  return format(`
let sign = function n when n < 0 -> "neg" | _ -> "pos"
`).then(x =>
    expect(x).toEqual(`\
let sign =
  function
  | n when n < 0 -> "neg"
  | _ -> "pos"`))
})

test("constructor patterns as parameters", () => {
  return format(`
let a = fun (Some x) -> x
let b (Some x) (y, z) = x + y + z
`).then(x =>
    expect(x).toEqual(`\
let a (Some x) = x

let b (Some x) (y, z) = x + y + z`))
})
