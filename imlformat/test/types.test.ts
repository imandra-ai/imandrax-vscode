import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("record 1", () => {
  return format(`\
open Int

type foo = {
  x: Int.t;
  y: bool option;
}
`).then(x =>
    expect(x).toEqual(`\
open Int

type foo = { x : Int.t; y : bool option; }`))
});

test("variables 1", () => {
  return format(`type 'a t = ('a * 'a) list`).then(x =>
    expect(x).toEqual(`type 'a t = ('a * 'a) list`))
});

test("variables 2", () => {
  return format(`type ('a, 'b) t = ('a * 'b) list`).then(x =>
    expect(x).toEqual(`type ('a, 'b) t = ('a * 'b) list`))
});