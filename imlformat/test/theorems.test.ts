import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("theorem 1", () => {
  return format(`
    let f x = (x) + (1)

theorem
   thm1     x (y : int) z
   = f  x    >
    x
    && f
      y  > y
    && f  z > z
    [@@timeout
      3600 ]
  [@@disable   f ] [@@by
  [%expand "f"]
      @>
   auto]
  [@@by
    some
      other
        tactic]

`).then(x =>
    expect(x).toEqual(`\
let f x = x + 1

theorem thm1 x (y : int) z = f x > x && f y > y && f z > z
[@@timeout 3600]
[@@disable f]
[@@by [%expand "f"] @> auto]
[@@by some other tactic]`))
})

test("axiom", () => {
  return format(`
axiom zero_right x = x + 0 = x
`).then(x =>
    expect(x).toEqual(`\
axiom zero_right x = x + 0 = x`))
})

test("lemma at start of file", () => {
  return format(`lemma l x = x = x

lemma m x = x = x
`).then(x =>
    expect(x).toEqual(`\
lemma l x = x = x

lemma m x = x = x`))
})
