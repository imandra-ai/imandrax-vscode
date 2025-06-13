import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("decomp 1", () => {
  return format(`
let g x =
  if x > 22 then 9
  else 100 + x

let f x =
  if x > 99 then
    100
  else if x < 70 && x > 23
  then 89 + x
  else if x > 20
  then g x + 20
  else if x > -2 then
    103
  else 99
[@@decomp top ()]
`).then(x =>
    expect(x).toEqual(`\
let g x = if x > 22 then 9 else 100 + x

let f x =
  if
    x > 99
  then
    100
  else
    if
      x < 70 && x > 23
    then
      89 + x
    else
      if x > 20 then g x + 20 else if x > -2 then 103 else 99
[@@decomp top ()]`))
})