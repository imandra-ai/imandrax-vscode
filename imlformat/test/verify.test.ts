import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("verify 1", () => {
  return format(`\
verify (fun x -> 1 <> 2) [@@by ground_eval] [@@timeout 2]`
  ).then(x => expect(x).toEqual(`\
verify (fun x -> 1 <> 2)
[@@by ground_eval]
[@@timeout 2]`
  ))
});
