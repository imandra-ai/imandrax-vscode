import { test } from '@jest/globals';

import * as FMT from '../term-formatter'
import * as assert from 'assert';

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
      c: { view: { constructor: 'Const_q', num: "1", den: "3" } }
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

  assert.strictEqual(stripHtml(p),
`if xadsfasdfsadf > 500000 then
\txadsfasdfsadf < 300000
else
\txadsfasdfsadf > 700000`);
});

test("Unbroken If", () => {
  const p = FMT.prettify(120, {
    view: { constructor: "If", c: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(500000) } } }, type: "int" }] }, type: "bool" }, t: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "<", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(300000) } } }, type: "int" }] }, type: "bool" }, f: { view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: ">", type: "int -> int -> bool" } }, type: "int -> int -> bool" }, l: [{ view: { constructor: "Apply", f: { view: { constructor: "Sym", sym: { id: "xadsfasdfsadf/18", type: "int" } }, type: "int" }, l: [] }, type: "int" }, { view: { constructor: "Const", c: { view: { constructor: "Const_z", v: BigInt(700000) } } }, type: "int" }] }, type: "bool" } }, type: "bool"
  });

  assert.strictEqual(stripHtml(p), `if xadsfasdfsadf > 500000 then xadsfasdfsadf < 300000 else xadsfasdfsadf > 700000`);
});