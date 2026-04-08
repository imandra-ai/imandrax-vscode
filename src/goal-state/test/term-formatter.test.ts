import { test } from '@jest/globals';

import * as assert from 'assert';

import * as IXT from "../imandrax_types"
import * as FMT from '../term-formatter'

function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent ?? '';
}

test("Bool constants", () => {
  let p = FMT.prettify(80, {
    type: "bool",
    view: {
      constructor: "Const",
      c: { view: { constructor: 'Const_bool', v: true } }
    }
  });
  assert.strictEqual(stripHtml(p), "true");

  p = FMT.prettify(80, {
    type: "bool",
    view: {
      constructor: "Const",
      c: { view: { constructor: 'Const_bool', v: false } }
    }
  });
  assert.strictEqual(stripHtml(p), "false");
});

test("Rationals", () => {
  const p = FMT.prettify(80, {
    type: "bool",
    view: {
      constructor: "Const",
      c: { view: { constructor: 'Const_q', num: BigInt("1"), den: BigInt("3") } }
    }
  });
  assert.strictEqual(stripHtml(p), "1.0 /. 3.0");
});


test("Function call in predicate", () => {
  const p = FMT.prettify(80, {
    view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "f/1kjKIDTiUHwCwtrmlSoBGO7ga7OBQD9qkIgSwEkPdIc", type: "int -> int" } }, type: "int -> int" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }] }, type: "int" }, { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }] }, type: "bool"
  }

  );
  assert.strictEqual(stripHtml(p), "f xadsfasdfsadf > xadsfasdfsadf");
});

test("Broken if", () => {
  const p = FMT.prettify(80, {
    view: { constructor: "If", c: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(500000) } } }, type: "int" }] }, type: "bool" }, t: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "<", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(300000) } } }, type: "int" }] }, type: "bool" }, f: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(700000) } } }, type: "int" }] }, type: "bool" } }, type: "bool"
  });

  assert.strictEqual(stripHtml(p),`\
if xadsfasdfsadf > 500000 then
\txadsfasdfsadf < 300000
else
\txadsfasdfsadf > 700000`);
});

test("Unbroken If", () => {
  const p = FMT.prettify(81, {
    view: { constructor: "If", c: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(500000) } } }, type: "int" }] }, type: "bool" }, t: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "<", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(300000) } } }, type: "int" }] }, type: "bool" }, f: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(700000) } } }, type: "int" }] }, type: "bool" } }, type: "bool"
  });

  assert.strictEqual(stripHtml(p), `if xadsfasdfsadf > 500000 then xadsfasdfsadf < 300000 else xadsfasdfsadf > 700000`);
});

test("No parentheses for plusminus", () => {
  const p = FMT.prettify(120, {
    view: {
      constructor: "Apply",
      f: { view: { constructor: "Sym", sym: { id: "+", type: "int -> int -> int" } }, type: "int -> int -> int" },
      l: [
        {
          view: {
            constructor: "Apply",
            f: { view: { constructor: "Sym", sym: { id: "-", type: "int -> int -> int" } }, type: "int -> int -> int" },
            l: [
              { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "x/18", type: "int" } }, type: "int" }, l: [] }, type: "int" },
              { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(1) } } }, type: "int" }
            ]
          }, type: "int"
        },
        { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(2) } } }, type: "int" }]
    }, type: "int"
  });

  assert.strictEqual(stripHtml(p), `x - 1 + 2`);
});

test("Parentheses for f(f(x))", () => {
  const p = FMT.prettify(120, {
    view: {
      constructor: "Apply",
      f: { view: { constructor: "Sym", sym: { id: "f", type: "int -> int -> int" } }, type: "int -> int -> int" },
      l: [
        {
          view: {
            constructor: "Apply",
            f: { view: { constructor: "Sym", sym: { id: "f", type: "int -> int -> int" } }, type: "int -> int -> int" },
            l: [
              { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "x/18", type: "int" } }, type: "int" }, l: [] }, type: "int" },
            ]
          }, type: "int"
        }]
    }, type: "int"
  });

  assert.strictEqual(stripHtml(p), `f (f x)`);
});


test("If with destruct", () => {
  const t : IXT.Term = { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "=", type: "real -> real -> bool" } }, type: "real -> real -> bool" }, "l": [ { view: { constructor: "If", c: { view: { constructor: "Is_a", c: { id: "A/zI3rjyXxwOWLgODCImXhzBqgmRexOAgFeOKj2Sa2sc0", type: "(int * real) -> u" }, t: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "x/23", type: "u" } }, type: "u" }, "l": [] }, type: "u" } }, type: "bool" }, t: { view: { constructor: "Tuple_field", i: BigInt(1), t: { view: { constructor: "Destruct", c: { id: "A/zI3rjyXxwOWLgODCImXhzBqgmRexOAgFeOKj2Sa2sc0", type: "(int * real) -> u" }, i: BigInt(0), t: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "x/23", type: "u" } }, type: "u" }, "l": [] }, type: "u" } }, type: "(int * real)" } }, type: "real" }, f: { view: { constructor: "If", c: { view: { constructor: "Is_a", c: { id: "B/uJ6ljfIP5KGEFDyfFkvc7JCZDX3m_DtDdILPuNYm55s", type: "float -> u" }, t: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "x/23", type: "u" } }, type: "u" }, "l": [] }, type: "u" } }, type: "bool" }, t: { view: { constructor: "Const", c: { view: { constructor: "Const_q", num: BigInt(2), den: BigInt(1) } } }, type: "real" }, f: { view: { constructor: "Const", c: { view: { constructor: "Const_q", num: BigInt(4), den: BigInt(1) } } }, type: "real" } }, type: "real" } }, type: "real" }, { view: { constructor: "Const", c: { view: { constructor: "Const_q", num: BigInt(3), den: BigInt(1) } } }, type: "real" } ] }, type: "bool" }
  let p = FMT.prettify(77, t);

  // Fits into 77 characters.
  assert.strictEqual(stripHtml(p), `(if x is_a A then destruct[A|0] x.1 else if x is_a B then 2.0 else 4.0) = 3.0`);

  // Doesn't fit into 76 characters.
  p = FMT.prettify(76, t);
  assert.strictEqual(stripHtml(p), `\
(if x is_a A then destruct[A|0] x.1 else if x is_a B then 2.0 else 4.0)
=
3.0`);
})