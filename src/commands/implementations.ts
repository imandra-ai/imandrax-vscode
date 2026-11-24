import * as Path from 'path';

import { commands, env, Range, TerminalOptions, Uri, window, workspace } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { getExtensionConfig } from '../config';

let next_terminal_id = 0;
let model_count = 0;
export let showFullIds = false;

export function create_terminal(cwd: string | undefined) {
  const config = getExtensionConfig();

  let name = "ImandraX";
  if (next_terminal_id++ > 0) {
    name += ` #${next_terminal_id}`;
  }

  if (cwd === undefined && workspace?.workspaceFolders !== undefined) {
    cwd = workspace.workspaceFolders[0].uri.path;
  }

  const options: TerminalOptions = { name: name, shellPath: config.terminal.binary, shellArgs: config.terminal.arguments, cwd: cwd };
  const t = window.createTerminal(options);
  t.show();
  return t;
}

interface Models {
  uri: string;
  models: string[];
}

export function interact_model(params: Models) {
  const config = getExtensionConfig();

  const uri = Uri.parse(params.uri);
  const models = params.models;

  const wsf = workspace.getWorkspaceFolder(uri);

  let cwd: string;
  let filename: string;

  if (wsf === undefined) {
    cwd = Path.dirname(uri.path);
    filename = Path.basename(uri.path);
  } else {
    cwd = wsf.uri.path;
    const rel = Path.relative(wsf.uri.path, Path.dirname(uri.path));
    filename = Path.join(rel, Path.basename(uri.path));
  }

  let file_mod_name = Path.basename(uri.path, Path.extname(uri.path));
  file_mod_name = file_mod_name.charAt(0).toUpperCase() + file_mod_name.slice(1);

  const t = create_terminal(cwd);

  models.forEach((model_src: string) => {
    model_src = model_src.replaceAll("\n", " \n"); // Avoids errors with empty models
    if (config.terminal.freshModelModules) {
      model_src = model_src.replace("module M =", "module M" + (model_count++).toString() + " =");
    }
    t.sendText(`[@@@import ${file_mod_name}, "${filename}"];;\n`);
    t.sendText(`open ${file_mod_name};;\n`);
    t.sendText(model_src + ";;\n");
  });

  t.show();
}

export function copy_model(params: Models) {
  const models = params.models;
  let str = "";
  models.join();
  models.forEach((m: string) => {
    str += "\n" + m.replaceAll("\n\n", "\n");
  });
  env.clipboard.writeText(str);
}

export function browse(uri: string): Thenable<boolean> | undefined {
  const config = getExtensionConfig();
  if (config.useSimpleBrowser) {
    return commands.executeCommand("simpleBrowser.api.open", uri);
  } else {
    return env.openExternal(Uri.parse(uri));
  }
}

export function toggle_full_ids(getClient: () => LanguageClient): Thenable<void> | undefined {
  if (getClient()?.isRunning()) {
    showFullIds = !showFullIds;
    return getClient().sendNotification("workspace/didChangeConfiguration", { "settings": { "show-full-ids": showFullIds } });
  }
}

export function terminal_eval_selection(): boolean {
  const editor = window.activeTextEditor;
  const selection = editor?.selection;
  if (selection && !selection.isEmpty) {
    const selectionRange = new Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
    const highlighted = editor.document.getText(selectionRange);
    if (window.activeTerminal !== undefined) {
      window.activeTerminal.sendText(highlighted);
    }
  }
  return true;
}

export async function clear_cache(getClient: () => LanguageClient) {
  if (getClient()?.isRunning()) {
    await getClient().sendRequest("workspace/executeCommand", { "command": "clear-cache", "arguments": [] });
  }
  return true;
}
