import { commands, env, ExtensionContext, Range, TerminalOptions, Uri, ViewColumn, window, workspace } from 'vscode';
import * as interfaces from './interfaces';
import { client } from './lsp_client';
import * as lsp_client from './lsp_client';
import Path = require('path');

export let showFullIDs: boolean = false;

let next_terminal_id = 0;
let model_count = 0;

/** Register commands */
export function registerCommands(context: ExtensionContext) {

	const restart_cmd = "imandrax.restart_language_server";
	const restart_handler = () => { lsp_client.restart({ initial: false, extensionUri: context.extensionUri }); };
	context.subscriptions.push(commands.registerCommand(restart_cmd, restart_handler));

	const check_all_cmd = "imandrax.check_all";
	const check_all_handler = () => { check_all(); };
	context.subscriptions.push(commands.registerCommand(check_all_cmd, check_all_handler));

	const browse_cmd = "imandrax.browse";
	const browse_handler = (uri) => { browse(uri); };
	context.subscriptions.push(commands.registerCommand(browse_cmd, browse_handler));

	const toggle_full_ids_cmd = "imandrax.toggle_full_ids";
	const toggle_full_ids_handler = () => { toggle_full_ids(); };
	context.subscriptions.push(commands.registerCommand(toggle_full_ids_cmd, toggle_full_ids_handler));

	const create_terminal_cmd = "imandrax.create_terminal";
	const create_terminal_handler = () => { create_terminal(undefined); };
	context.subscriptions.push(commands.registerCommand(create_terminal_cmd, create_terminal_handler));

	const terminal_eval_selection_cmd = "imandrax.terminal_eval_selection";
	const terminal_eval_selection_handler = () => { terminal_eval_selection(); };
	context.subscriptions.push(commands.registerCommand(terminal_eval_selection_cmd, terminal_eval_selection_handler));

	const clear_cache_cmd = "imandrax.clear_cache";
	const clear_cache_handler = () => { clear_cache(); };
	context.subscriptions.push(commands.registerCommand(clear_cache_cmd, clear_cache_handler));

	const open_vfs_file_cmd = "imandrax.open_vfs_file";
	const open_vfs_file_handler = async () => {
		const what = await window.showInputBox({ placeHolder: 'file uri?' });
		if (what) {
			const uri = Uri.parse(what);
			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc, { preview: false });
		}
	};
	context.subscriptions.push(commands.registerCommand(open_vfs_file_cmd, open_vfs_file_handler));


	const reset_goal_state_cmd = "imandrax.reset_goal_state";
	const reset_goal_state_handler = () => {
		if (client && client.isRunning())
			client.sendRequest("workspace/executeCommand", { "command": "reset-goal-state", "arguments": [] });
		return true;
	};
	context.subscriptions.push(commands.registerCommand(reset_goal_state_cmd, reset_goal_state_handler));

}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	console.log("Deactivating ImandraX LSP server");
	if (client.isRunning())
		client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));
}

export function check_all(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	const file_uri = window.activeTextEditor.document.uri;
	if (client && client.isRunning() && file_uri.scheme == "file")
		client.sendRequest("workspace/executeCommand", { "command": "check-all", "arguments": [file_uri.toString()] });
}

export function browse(uri: string): Thenable<boolean> | undefined {
	const config = workspace.getConfiguration("imandrax");
	if (config.useSimpleBrowser)
		return commands.executeCommand("simpleBrowser.api.open", uri);
	else
		return env.openExternal(uri as any);
}

export function create_terminal(cwd: string | undefined) {
	const config = workspace.getConfiguration("imandrax");

	let name = "ImandraX";
	if (next_terminal_id++ > 0)
		name += ` #${next_terminal_id}`;

	if (cwd == undefined && workspace != undefined && workspace.workspaceFolders != undefined)
		cwd = workspace.workspaceFolders[0].uri.path;

	const options: TerminalOptions = { name: name, shellPath: config.terminal.binary, shellArgs: config.terminal.arguments, cwd: cwd };
	const t = window.createTerminal(options);
	t.show();
	return t;
}

function terminal_eval_selection(): boolean {
	const editor = window.activeTextEditor;
	const selection = editor.selection;
	if (selection && !selection.isEmpty) {
		const selectionRange = new Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
		const highlighted = editor.document.getText(selectionRange);
		if (window.activeTerminal != undefined)
			window.activeTerminal.sendText(highlighted);
	}
	return true;
}

export function copy_model(params: { models: string[] }) {
	const models = params["models"];
	let str = "";
	models.join();
	models.forEach(async m => {
		str += m;
	});
	env.clipboard.writeText(str);
}

export function visualize_decomp(extensionUri: Uri, params: { decomps: interfaces.Decomp[] }) {
	const decomps = params["decomps"];

	let body: string = "";
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
 	<link rel="stylesheet" href="${style_uri}">
	<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/2.2.4/jquery.min.js"></script>
	<script src="${voronoi_uri}"></script>
</head>
<body>
${body}
</body>
</html>`;

	// console.log(`DECOMP HTML: ${html}`);

	panel.webview.html = html;
}

function clear_cache() {
	if (client && client.isRunning())
		client.sendRequest("workspace/executeCommand", { "command": "clear-cache", "arguments": [] });
	return true;
}

export function interact_model(params: { uri: string, models: string[] }) {
	const config = workspace.getConfiguration("imandrax");

	const uri = Uri.parse(params["uri"]);
	const models = params["models"];

	const wsf = workspace.getWorkspaceFolder(uri);

	let cwd: string = "";
	let filename: string = "";

	if (wsf == undefined) {
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

	models.forEach(async model_mod_name => {
		if (config.terminal.freshModelModules)
			model_mod_name = model_mod_name.replace("module M", "module M" + (model_count++).toString());
		t.sendText(`[@@@import ${file_mod_name}, "${filename}"];;\n`);
		t.sendText(`open ${file_mod_name};;\n`);
		t.sendText(model_mod_name + ";;\n");
	});

	t.show();
}

export function toggle_full_ids(): Thenable<void> | undefined {
	if (client && client.isRunning()) {
		showFullIDs = !showFullIDs;
		return client.sendNotification("workspace/didChangeConfiguration", { "settings": { "show-full-ids": showFullIDs } });
	}
}