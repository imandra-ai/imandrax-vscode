
import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("constants", () => {
  return format(`
let a = 1
let b = (- 1)
let c = 1.0
let d = (- 1.0)
let e = "abc"
`).then(x =>
    expect(x).toEqual(`\
let a = 1

let b = -1

let c = 1.0

let d = -1.0

let e = "abc"`))
})


test("function", () => {
  return format(`
let
g
?(x)
~(y:real)
=
  42
`).then(x =>
    expect(x).toEqual(`let g ?x ~(y : real) = 42`))
})

test("theorem", () => {
  return format(`
theorem
   f_gt     x
   = ((f  x   ) >
    x)
`).then(x =>
    expect(x).toEqual(`theorem f_gt x = f x > x`))
})

test("eval", () => {
  return format(`
eval (
f 0)
   ;;
`).then(x =>
    expect(x).toEqual(`eval (f 0)`))
})

test("variant type", () => {
  return format(`
type
  u = A |
B
`).then(x =>
    expect(x).toEqual(`type u = A | B`))
})

test("record type", () => {
  return format(`
type
  t =
    { a: int; b : float; c :int; d : float;
      e :int; f :float; g :int; h : float;
      i : int; j :float; k :int; l: float;
}
`).then(x =>
    expect(x).toEqual(`\
type t =
    { a : int; b : float; c : int; d : float; e : int; f : float; g : int; h :
      float; i : int; j : float; k : int; l : float; }`
    ))
})

test("directive", () => {
  return format(`
  #somedirective
   "def";;
`).then(x =>
    expect(x).toEqual(`#somedirective "def";;`))
})

test("operator precedence", () => {
  return format(`let f x y = ((x - 1) * (y + 1)) + 1`)
    .then(x => expect(x).toEqual(`let f x y = (x - 1) * (y + 1) + 1`))
})