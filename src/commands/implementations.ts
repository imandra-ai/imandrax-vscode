import * as Path from 'path';

import { commands, env, Range, TerminalOptions, Uri, ViewColumn, window, workspace } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { getConfig } from '../config';

let next_terminal_id = 0;
let model_count = 0;
export let showFullIds = false;

export function create_terminal(cwd: string | undefined) {
  const config = getConfig();

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
  const config = getConfig();

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

interface Decomp {
  source: string, // Function name
  decomp: string, // HTML-encoded regions for voronoi
  num_regions: number // Number of regions
}

function num_bytes_to_string(num: number): string {
  const units = ["Bytes", "KB", "MB", "GB", "TB"];
  let n = num;
  let i = 0
  for (; i < units.length; i++) {
    if (n > 1024)
      n /= 1024;
    else
      break;
  }
  return `${n.toFixed(0)} ${units[i]}`;
}

export async function visualize_decomp(extensionUri: Uri, params: { decomps: Decomp[] }) {
  const config = getConfig();

  const decomps = params.decomps;

  let body = "";
  const sources: string[] = [];

  let total_regions = 0;
  let total_bytes = 0;
  for (const d of decomps) {
    if ("num_regions" in d)
      total_regions += d.num_regions;
    total_bytes += d.decomp.length;
  }

  let do_display = true;

  if (total_bytes > config.largeDecompConfirmationBytes) {
    const q = await window.showWarningMessage(
      `This decomposition is not displayed in the editor because it is very large (${num_bytes_to_string(total_bytes)}).`,
      {},
      { title: "Open Anyway" },
      { title: "Cancel", isCloseAffordance: true },
      { title: "Configure Limit" });

    do_display = q?.title == "Open Anyway";

    if (q?.title == "Configure Limit")
      commands.executeCommand("workbench.action.openSettings", "imandrax.largeDecompConfirmationBytes");
  }

  if (do_display && total_regions > config.largeDecompConfirmation) {
    const q = await window.showWarningMessage(
      `This decomposition is not displayed in the editor because it is very large (${total_regions} regions).`,
      {},
      { title: "Open Anyway" },
      { title: "Cancel", isCloseAffordance: true },
      { title: "Configure Limit" });

    do_display = q?.title == "Open Anyway";

    if (q?.title == "Configure Limit")
      commands.executeCommand("workbench.action.openSettings", "imandrax.largeDecompConfirmation");
  }

  if (!do_display)
    return;

  for (const d of decomps) {
    const source = d.source;
    body += `<h1>Decomposition of <span class="code">${source}</span></h1>`;
    body += d.decomp;
    sources.push(source);
  }

  const sources_str = sources.join(", ");

  const panel = window.createWebviewPanel("imandrax-decomp", `Decomposition of ${sources_str}`, ViewColumn.One, {
    enableScripts: true, localResourceRoots: [
      Uri.joinPath(extensionUri, "assets")
    ],
    enableCommandUris: true
  });

  const pwv = panel.webview;
  const assets_path = Uri.joinPath(extensionUri, "assets");
  const voronoi_uri = pwv.asWebviewUri(Uri.joinPath(assets_path, "voronoi.js")).toString();
  const imandrax_hydrate_uri = pwv.asWebviewUri(Uri.joinPath(assets_path, "imandrax-hydrate.js")).toString();
  const style1_uri = pwv.asWebviewUri(Uri.joinPath(assets_path, "decomp-style.css")).toString();
  const style2_uri = pwv.asWebviewUri(Uri.joinPath(assets_path, "styles.b466ce6f.css")).toString();
  const style3_uri = pwv.asWebviewUri(Uri.joinPath(assets_path, "style.min.98373da4.css")).toString();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="${style2_uri}">
  <link rel="stylesheet" href="${style3_uri}">
  <link rel="stylesheet" href="${style1_uri}">
	<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/2.2.4/jquery.min.js"></script>
	<script src="${voronoi_uri}"></script>
	<script src="${imandrax_hydrate_uri}"></script>
</head>
<body style="background-color: transparent;">
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
  const config = getConfig();
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
