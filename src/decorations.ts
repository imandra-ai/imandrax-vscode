import * as Path from 'path';

import { DecorationRenderOptions, ExtensionContext, TextEditorDecorationType, window } from 'vscode';

export let decoration_type_good: TextEditorDecorationType;
export let decoration_type_bad: TextEditorDecorationType;

export function initialize(context: ExtensionContext) {
  const render_options_good: DecorationRenderOptions = {
    gutterIconPath:
      context.asAbsolutePath(Path.join("assets", "imandra-smile.png")),
    overviewRulerColor: "green",
    gutterIconSize: "70%",
    outlineColor: "green",
  };
  const render_options_bad: DecorationRenderOptions = {
    gutterIconPath:
      context.asAbsolutePath(Path.join("assets", "imandra-wut.png")),
    overviewRulerColor: "orange",
    gutterIconSize: "70%",
    outlineColor: "green",
  };
  decoration_type_good = window.createTextEditorDecorationType(render_options_good);
  decoration_type_bad = window.createTextEditorDecorationType(render_options_bad);
}
