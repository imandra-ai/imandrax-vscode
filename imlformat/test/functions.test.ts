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
