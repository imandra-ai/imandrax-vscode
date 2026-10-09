import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("char escapes", () => {
  return format(`
let nl = '\\n'
let quote = '\\''
let dquote = '"'
`).then(x =>
    expect(x).toEqual(`\
let nl = '\\n'

let quote = '\\''

let dquote = '"'`))
})

test("string escapes", () => {
  return format(`
let s = "hello \\"world\\"\\n"
let b = "back\\\\slash\\t\\065\\x41\\o101"
`).then(x =>
    expect(x).toEqual(`\
let s = "hello \\"world\\"\\n"

let b = "back\\\\slash\\t\\065\\x41\\o101"`))
})

test("quoted strings", () => {
  return format(`
let q = {l|raw "string"|l}
let r = {|no "id"|}
`).then(x =>
    expect(x).toEqual(`\
let q = {l|raw "string"|l}

let r = {|no "id"|}`))
})
