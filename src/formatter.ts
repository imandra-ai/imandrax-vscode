import { languages, Range, TextDocument, TextEdit, workspace } from 'vscode';

import CP = require('child_process');


export function register() {
  // Register formatter
  languages.registerDocumentFormattingEditProvider("imandrax", {
    provideDocumentFormattingEdits(document: TextDocument): TextEdit[] {
      const config = workspace.getConfiguration("imandrax");
      const cmd_args: string[] = config.lsp.formatter;
      if (!cmd_args || cmd_args.length == 0)
        return [];
      else {
        const out = CP.execSync(cmd_args.join(" ") + " " + document.fileName);
        const rng = new Range(0, 0, document.lineCount, 0);
        document.validateRange(rng);
        return [TextEdit.replace(rng, out.toString())];
      }
    }
  });
}