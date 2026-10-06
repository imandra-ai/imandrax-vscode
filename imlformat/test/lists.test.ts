
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

test("cons of tuples", () => {
  return format(`
let push x y l = (x, y) :: l

let m = (x, y) :: (z, w) :: []

let n = 1 :: 2 :: rest
`).then(x =>
    expect(x).toEqual(`\
let push x y l = (x, y) :: l

let m = [ x, y; z, w ]

let n = 1 :: 2 :: rest`))
})

test("list elements with match", () => {
  return format(`
let i = [ (match x with _ -> 2); 3 ]
`).then(x =>
    expect(x).toEqual(`\
let i = [ (match x with _ -> 2); 3 ]`))
})
