import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("record 1", () => {
  format(`\
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