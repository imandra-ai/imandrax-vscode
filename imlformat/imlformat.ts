import * as fs from 'node:fs';
import { Buffer } from 'node:buffer';

import * as prettier from 'prettier';
import * as iml_prettier from './iml-prettier';
import * as fmt from './imlformat.format';

// Run me like so:
// npm install
// npx ts-node imlformat.ts

// Maybe compile a binary along these lines?
// deno compile --unstable-sloppy-imports --no-check -A -o runme imlformat.ts

(async function main() {
  if (process.argv.length <= 2)
    console.log("Usage: npx ts-node imlformat.ts <filename>");
  else {
    let r = await fmt.format_file(process.argv[2]);
    console.log(r);
  }
})();