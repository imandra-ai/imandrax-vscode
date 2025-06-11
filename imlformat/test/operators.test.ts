import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("Example from OCaml", () => {
  format(`3 + 3 mod 2, 3 + (3 mod 2), (3 + 3) mod 2`).then(x =>
    expect(x).toEqual(`(3 + 3 mod 2, 3 + 3 mod 2, (3 + 3) mod 2)`))
})