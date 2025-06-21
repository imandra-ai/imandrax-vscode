import * as fs from 'node:fs';
import { Buffer } from 'node:buffer';

import * as prettier from 'prettier';
import * as iml_prettier from './iml-prettier';

export async function format(text: string, config_root: string | null = null): Promise<string> {
  try {
    let options: prettier.Options | null = null;
    if (config_root) {
      const config_file = await prettier.resolveConfigFile(config_root);
      if (config_file)
        options = await prettier.resolveConfig(config_file);
    }
    if (!options) {
      options = {
        semi: false
      };
    }
    options.parser = "iml-parse";
    options.plugins = [iml_prettier];
    return await prettier.format(text, options);
  }
  catch (e: any) {
    console.log("Prettier error: " + e.toString() + "\n" + e.stack.toString());
    return "";
  }
}

export async function format_file(filename: string): Promise<string> {
  const stats = fs.statSync(filename);
  const buffer = Buffer.allocUnsafe(stats.size);
  const fd = fs.openSync(filename, "r");
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  return await format(buffer.toString(), filename);
}