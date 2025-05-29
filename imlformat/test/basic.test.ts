import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("function", () => {
  format(`
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
  format(`
theorem
   f_gt     x
   = ((f  x   ) >
    x)
`).then(x =>
    expect(x).toEqual(`theorem f_gt x = (f x) > x`))
})

test("eval", () => {
  format(`
eval (
f 0)
   ;;
`).then(x =>
    expect(x).toEqual(`eval (f 0)`))
})

test("variant type", () => {
  format(`
type
  u = A |
B
`).then(x =>
    expect(x).toEqual(`type u = A | B`))
})

test("record type", () => {
  format(`
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
  format(`
  #somedirective
   "def";;
`).then(x =>
    expect(x).toEqual(`#somedirective "def";;`))
})