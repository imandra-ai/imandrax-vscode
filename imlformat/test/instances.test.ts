import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("instance 1", () => {
  return format(`
  let c n =
  if n <= 0 then
    false
  else
    true
;;

instance c
`).then(x =>
    expect(x).toEqual(`\
let c n = if n <= 0 then false else true;;

instance (c)`))
});

test("instance 2", () => {
  return format(`
instance (
  fun x
  ->
  x > 0);;
`).then(x =>
    expect(x).toEqual(`\
instance (fun x -> x > 0);;`))
});

test("instance 2 nosemisemi", () => {
  return format(`
instance (
  fun x
  ->
  x > 0)
`).then(x =>
    expect(x).toEqual(`\
instance (fun x -> x > 0)`))
});