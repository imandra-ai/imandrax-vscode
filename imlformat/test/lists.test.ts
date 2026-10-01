
import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("literals", () => {
  return format(`let x = [1; 2; 3]`).then(x =>
    expect(x).toEqual(`let x = [ 1; 2; 3 ]`))
})

test("one tuple", () => {
  return format(`let x = [1, 2, 3]`).then(x =>
    expect(x).toEqual(`let x = [ 1, 2, 3 ]`))
})