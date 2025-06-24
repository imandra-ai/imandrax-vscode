import { languages, Range, TextDocument, TextEdit } from 'vscode';

import * as prettier from 'prettier';
import * as iml_prettier from 'imlformat/iml-prettier';

export function register() {
  // Register formatter
  languages.registerDocumentFormattingEditProvider('imandrax', {
    async provideDocumentFormattingEdits(document: TextDocument): Promise<TextEdit[]> {
      try {
        let formatted = "";

        formatted = await prettier.format(document.getText(), {
          semi: false,
          parser: "iml-parse",
          plugins: [iml_prettier],
        });

        const start = document.lineAt(0);
        const end = document.lineAt(document.lineCount - 1);
        const range = new Range(start.range.start, end.range.end);

        return [TextEdit.replace(range, formatted)];
      } catch (e) {
        console.log(`Formatting error: ${e as string}`);
      }
      return [];
    }
  });
}
