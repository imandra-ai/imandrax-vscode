import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("attributes 1", () => {
  return format(`\
let f x = 1 [@@macro] [@@no_extract]`
  ).then(x => expect(x).toEqual(`\
let f x = 1 [@@macro] [@@no_extract]`
  ))
});
