import * as fs from 'node:fs';
import { Buffer } from 'node:buffer';

import * as prettier from 'prettier';
import * as iml_prettier from './iml-prettier';

// Run me like so:
// npm install
// npx ts-node imlformat.ts

// Maybe compile a binary along these lines?
// deno compile --unstable-sloppy-imports --no-check -A -o runme imlformat.ts

(async function main() {
	if (process.argv.length <= 2) {
		console.log("Usage: npx ts-node imlformat.ts <filename>");
	}
	else {
		const filename = process.argv[2];
		const stats = fs.statSync(filename);
		const buffer = Buffer.allocUnsafe(stats.size);
		const fd = fs.openSync(filename, "r");
		fs.readSync(fd, buffer, 0, buffer.length, 0);

		let formatted = "";

		try {
			formatted = await prettier.format(buffer.toString(), {
				semi: false,
				parser: "iml-parse",
				plugins: [iml_prettier],
			});
			console.log(formatted);
		}
		catch (e: any) {
			console.log("Prettier error: " + e.toString() + "\n" + e.stack.toString());
		}
	}
})();