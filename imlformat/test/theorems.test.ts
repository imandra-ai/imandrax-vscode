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