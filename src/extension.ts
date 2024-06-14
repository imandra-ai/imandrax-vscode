import { workspace, window, ExtensionContext, commands, env, Uri, Terminal, TerminalOptions, Range, WorkspaceConfiguration, languages } from "vscode";

import {
	Executable,
	ExecutableOptions,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	VersionedTextDocumentIdentifier,
	State,
} from "vscode-languageclient/node";

const MAX_RESTARTS: number = 10;

let numManualRestarts: number = 0;
let client: LanguageClient;
let showFullIDs: boolean = false;
let next_terminal_id = 0;
let config: WorkspaceConfiguration;

export function activate(context: ExtensionContext) {
	console.log("activating imandrax lsp");

	// Register commands
	const restart_cmd = "imandrax.restart_language_server";
	const restart_handler = () => { restart(); };
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
	const create_terminal_handler = () => { create_terminal(); };
	context.subscriptions.push(commands.registerCommand(create_terminal_cmd, create_terminal_handler));

	const terminal_eval_selection_cmd = "imandrax.terminal_eval_selection";
	const terminal_eval_selection_handler = () => { terminal_eval_selection(); };
	context.subscriptions.push(commands.registerCommand(terminal_eval_selection_cmd, terminal_eval_selection_handler));

	
	// Start language server
	config = workspace.getConfiguration("imandrax");
	const binary = config.lsp.binary;
	const server_args = config.lsp.arguments;
	const server_env = config.lsp.environment;

	const system_env = process.env;
	const merged_env = Object.assign(system_env, server_env);

	const serverOptions: Executable = { command: binary, args: server_args, options: { env: merged_env } };

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: "file", language: "imandrax" }],
		stdioEncoding: "utf-8",
		connectionOptions: {
			maxRestartCount: MAX_RESTARTS,
		},
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher("**/*.iml")
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		"imandrax_lsp",
		"ImandraX LSP",
		serverOptions,
		clientOptions
	);

	client.onRequest("$imandrax/interact-model", (params) => { interact_model(params); });

	// Start the client. This will also launch the server
	console.log("starting client");
	client.start();
}

// Sleep for the number of seconds
async function sleep(time_s: number) {
	return new Promise(resolve => setTimeout(resolve, time_s * 1000));
}

export function restart(): Thenable<void> | undefined {
	numManualRestarts += 1;
	if (!client) {
		return undefined;
	}

	console.log("restarting imandrax lsp server (attempt ${numManualRestarts})");
	return (client.state == State.Stopped) ? client.start() : client.restart();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	console.log("deactivating imandrax lsp server");
	const c = client;
	client = null;
	return c.stop();
}

export function check_all(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	const file_uri = window.activeTextEditor.document.uri;
	client.sendRequest("workspace/executeCommand", { "command": "check-all", "arguments": [file_uri.toString()] });
}

export function browse(uri: string): Thenable<boolean> | undefined {
	return env.openExternal(uri as any);
}

export function toggle_full_ids(): Thenable<void> | undefined {
	showFullIDs = !showFullIDs;
	return client.sendNotification("workspace/didChangeConfiguration", { "settings": { "show-full-ids": showFullIDs } });
}

function create_terminal() {
	let name = "ImandraX";
	if (next_terminal_id++ > 0)
		name += " #${next_terminal_id}";

	const cwd = workspace.workspaceFolders == undefined || workspace.workspaceFolders.length == 0 ? undefined : workspace.workspaceFolders[0].uri;
	const options: TerminalOptions = { name: name, shellPath: config.lsp.binary, shellArgs: ["repl"], cwd: cwd };
	const t = window.createTerminal(options);
	t.show();
	return t;
}

function findTerminal(): Terminal {
	let t = window.terminals.find((t, i, obj) => t.name.startsWith("ImandraX"));
	if (t == undefined)
		t = create_terminal();
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

function interact_model(params) {
	// const uri = params["uri"];
	const models = params["models"];
	const t = findTerminal();
	let i = 0;
	models.forEach(m => {
		t.sendText(m + " in m" + (i++).toString() + ";;");
	});

	return true;
}