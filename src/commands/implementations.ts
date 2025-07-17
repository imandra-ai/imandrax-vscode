import * as Path from 'path';

import { commands, env, Range, TerminalOptions, Uri, ViewColumn, window, workspace } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

let next_terminal_id = 0;
let model_count = 0;
export let showFullIds = false;

export function create_terminal(cwd: string | undefined) {
  const config = workspace.getConfiguration("imandrax");

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

export function interact_model(params: Record<string, any>) {
  const config = workspace.getConfiguration("imandrax");

  const uri = Uri.parse(params["uri"]);
  const models = params["models"];

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

  models.forEach((model_mod_name: string) => {
    if (config.terminal.freshModelModules) {
      model_mod_name = model_mod_name.replace("module M", "module M" + (model_count++).toString());
    }
    t.sendText(`[@@@import ${file_mod_name}, "${filename}"];;\n`);
    t.sendText(`open ${file_mod_name};;\n`);
    t.sendText(model_mod_name + ";;\n");
  });

  t.show();
}

export function copy_model(params: Record<string, any>) {
  const models = params["models"];
  let str = "";
  models.join();
  models.forEach((m: string) => {
    str += m;
  });
  env.clipboard.writeText(str);
}

export function visualize_decomp(extensionUri: Uri, params: Record<string, any>) {
  const decomps = params["decomps"];

  let body = "";
  const sources: string[] = [];

  for (const d of decomps) {
    const source = d["source"];
    body += `<h1>Decomposition of <span class="code">${source}</span></h1>`;
    body += d["decomp"];
    sources.push(source);
  }

  const sources_str = sources.join(", ");

  const panel = window.createWebviewPanel("imandrax-decomp", `Decomposition of ${sources_str}`, ViewColumn.One, {
    enableScripts: true, localResourceRoots: [
      Uri.joinPath(extensionUri, "assets")
    ],
    enableCommandUris: true,
  });

  const style_path = Uri.joinPath(extensionUri, "assets", "decomp-style.css");
  const style_uri = panel.webview.asWebviewUri(style_path);

  const voronoi_path = Uri.joinPath(extensionUri, "assets", "voronoi.js");
  const voronoi_uri = panel.webview.asWebviewUri(voronoi_path);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="${style_uri.toString()}">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/2.2.4/jquery.min.js"></script>
  <script src="${voronoi_uri.toString()}"></script>
</head>
<body>
${body}
</body>
</html>`;

  // console.log(`DECOMP HTML: ${html}`);

  panel.webview.html = html;
}

export async function checkAll(getClient: () => LanguageClient) {
  if (!getClient()) {
    return undefined;
  }
  const file_uri = window.activeTextEditor?.document.uri;
  if (getClient() && getClient().isRunning() && file_uri?.scheme === "file") {
    await getClient().sendRequest("workspace/executeCommand", { "command": "check-all", "arguments": [file_uri.toString()] });
  }
}

export function browse(uri: string): Thenable<boolean> | undefined {
  const config = workspace.getConfiguration("imandrax");
  if (config.useSimpleBrowser) {
    return commands.executeCommand("simpleBrowser.api.open", uri);
  } else {
    return env.openExternal(uri as any);
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
