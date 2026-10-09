import { expect, test } from '@jest/globals';

import { format } from "../imlformat.format";

test("output_type", () => {
  return format(`let f x : bool = x = 0`).then(x => expect(x).toEqual(`let f x : bool = x = 0`));
})

test("no_output_type", () => {
  return format(`let f x = x = 0`).then(x => expect(x).toEqual(`let f x = x = 0`));
})

test("eval_poly", () => {
  return format(`\
let rec eval_poly (p:poly) (x:Real.t list) : Real.t =
  match p, x with
  | a :: p, b :: x ->
    Real.(a*b + eval_poly p x)
  | [a], [] -> a
  | _ -> 0.0`
  ).then(x => expect(x).toEqual(`\
let rec eval_poly (p : poly) (x : Real.t list) : Real.t =
  match p, x with
  | a::p, b::x -> Real.(a * b + eval_poly p x)
  | [a], [] -> a
  | _ -> 0.0`
  ))
});

test("eval_system", () => {
  return format(`\
let rec eval_system (es:system) (x:Real.t list) : bool =
  match es with
  | [] -> true
  | e::es -> eval_expr e x && eval_system es x`
  ).then(x => expect(x).toEqual(`\
let rec eval_system (es : system) (x : Real.t list) : bool =
  match es with [] -> true | e::es -> eval_expr e x && eval_system es x`))
});

test("applied anonymous function", () => {
  return format(`
let three = (fun x -> x + 1) 2
`).then(x =>
    expect(x).toEqual(`\
let three = (fun x -> x + 1) 2`))
})

test("mutually recursive functions", () => {
  return format(`
let rec even n = if n = 0 then true else odd (n - 1)
and odd n = if n = 0 then false else even (n - 1)
`).then(x =>
    expect(x).toEqual(`\
let rec even n = if n = 0 then true else odd (n - 1)
and odd n = if n = 0 then false else even (n - 1)`))
})

test("field access on applications", () => {
  return format(`
let get r = (f r).x

let get2 r = (f r).y.z

theorem deposit_increases a x =
  x >. 0.0 ==> (deposit a x).balance >. a.balance
`).then(x =>
    expect(x).toEqual(`\
let get r = (f r).x

let get2 r = (f r).y.z

theorem deposit_increases a x = x >. 0.0 ==> (deposit a x).balance >. a.balance`))
})

test("binding with type annotation and function", () => {
  return format(`
let e : int -> int = fun x -> x
`).then(x =>
    expect(x).toEqual(`\
let e : int -> int = fun x -> x`))
})
