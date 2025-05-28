import * as fs from 'node:fs';
import { Buffer } from 'node:buffer';

import * as prettier from 'prettier';
import * as iml_prettier from './iml-prettier';

export async function format(text : string): Promise<string> {
  try {
    let formatted = await prettier.format(text, {
      semi: false,
      parser: "iml-parse",
      plugins: [iml_prettier],
    });
    return formatted;
  }
  catch (e: any) {
    console.log("Prettier error: " + e.toString() + "\n" + e.stack.toString());
  }
}

export async function format_file(filename: string): Promise<string> {
  const stats = fs.statSync(filename);
  const buffer = Buffer.allocUnsafe(stats.size);
  const fd = fs.openSync(filename, "r");
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  return await format(buffer.toString());
}