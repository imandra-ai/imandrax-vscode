import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("instance 1", () => {
  format(`
  let c n =
  if n <= 0 then
    false
  else
    true
;;

instance c
`).then(x =>
    expect(x).toEqual(`\
let c n = if n <= 0 then false else true

instance (c)`))
});

test("instance 2", () => {
  format(`
instance (
  fun x
  ->
  x > 0);;
`).then(x =>
    expect(x).toEqual(`\
instance (fun x -> x > 0)`))
});