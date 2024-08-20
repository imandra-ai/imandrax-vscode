import Path from 'path';

import {
	workspace,
	window,
	ExtensionContext,
	commands,
	env,
	Uri,
	TerminalOptions,
	Range,
	TextDocumentContentProvider,
	languages,
	DiagnosticChangeEvent,
	DecorationOptions,
	DecorationRenderOptions,
	DiagnosticSeverity,
	TextEditor,
	StatusBarAlignment,
	ThemeColor,
	StatusBarItem
} from "vscode";

import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	VersionedTextDocumentIdentifier,
} from "vscode-languageclient/node";

const MAX_RESTARTS: number = 10;

let context: ExtensionContext = undefined;
let clientRestarts: number = 0;
let client: LanguageClient = undefined;
let showFullIDs: boolean = false;
let next_terminal_id = 0;
let model_count = 0;
let decoration_type_good = undefined;
let decoration_type_bad = undefined;
let file_progress_sbi: StatusBarItem = undefined;
let file_progress_text: string = "No tasks";

export function activate(context_: ExtensionContext) {
	context = context_;

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
		const what = await window.showInputBox({ placeHolder: 'file name?' });
		if (what) {
			const uri = Uri.parse(what);
			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc, { preview: false });
		}
	};
	context.subscriptions.push(commands.registerCommand(open_vfs_file_cmd, open_vfs_file_handler));

	const vfs_provider = new (class implements TextDocumentContentProvider {
		async provideTextDocumentContent(uri: Uri): Promise<string> {
			return await client.sendRequest<string>("$imandrax/req-vfs-file", { "uri": uri });
		}
	})();
	context.subscriptions.push(workspace.registerTextDocumentContentProvider("imandrax-vfs", vfs_provider));

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

	languages.onDidChangeDiagnostics(diagnostic_listener, undefined, []);
	window.onDidChangeActiveTextEditor(active_editor_listener, undefined, []);

	const fileProgressCmdId = "file-progress-cmd";
	context.subscriptions.push(commands.registerCommand(fileProgressCmdId, () => {
		window.showInformationMessage(file_progress_text);
	}));

	file_progress_sbi = window.createStatusBarItem(StatusBarAlignment.Right, 0);
	file_progress_sbi.text = "100%";
	file_progress_sbi.command = fileProgressCmdId;
	file_progress_sbi.backgroundColor = undefined;
	context.subscriptions.push(file_progress_sbi);

	file_progress_sbi.show();

	restart(true);
}

function diagnostics_for_editor(editor: TextEditor) {
	const all_good: DecorationOptions[] = [];
	const all_bad: DecorationOptions[] = [];
	languages.getDiagnostics(editor.document.uri).forEach(d => {
		if (d.source == "lsp") {
			if (editor) {
				const good = d.severity == DiagnosticSeverity.Information || d.severity == DiagnosticSeverity.Hint;
				const decoration_options: DecorationOptions = { range: d.range.with(d.range.start, d.range.start) };
				if (good) all_good.push(decoration_options); else all_bad.push(decoration_options);
			}
		}
	}
	);
	editor.setDecorations(decoration_type_good, all_good);
	editor.setDecorations(decoration_type_bad, all_bad);
}

async function diagnostic_listener(e: DiagnosticChangeEvent) {
	diagnostics_for_editor(window.activeTextEditor);
	const file_uri = window.activeTextEditor.document.uri;
	if (file_uri.scheme == "file")
		req_file_progress(file_uri);
	else
		file_progress_sbi.hide();
}

async function active_editor_listener() {
	diagnostics_for_editor(window.activeTextEditor);
	const file_uri = window.activeTextEditor.document.uri;
	if (file_uri.scheme == "file")
		req_file_progress(file_uri);
	else
		file_progress_sbi.hide();
}

async function req_file_progress(uri: Uri) {
	client.sendRequest<string>("$imandrax/req-file-progress", { "uri": uri.path }).then((rsp) => {
		const task_stats = rsp["task_stats"];
		if (task_stats == null) file_progress_sbi.hide(); else {
			try {
				const finished = parseInt(task_stats["finished"]);
				const successful = parseInt(task_stats["successful"]);
				const failed = parseInt(task_stats["failed"]);
				const started = parseInt(task_stats["started"]);
				const total = parseInt(task_stats["total"]);
				if (total == 0) {
					file_progress_sbi.text = "100%";
					file_progress_sbi.backgroundColor = undefined;
					file_progress_text = "No tasks";
				}
				else {
					file_progress_sbi.text = `${successful}/${total}`;
					if (failed != 0)
						file_progress_sbi.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
					else if (successful != total)
						file_progress_sbi.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
					else
						file_progress_sbi.backgroundColor = undefined;
					file_progress_text = `${started} started, ${finished} finished, ${successful} successful, ${failed} failed, ${total} total tasks.`;
				}
				file_progress_sbi.show();
			} catch (_) {
				file_progress_sbi.hide();
			}
		}
	});
}

export async function start() {
	// Start language server
	const config = workspace.getConfiguration("imandrax");
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

	client.onRequest("$imandrax/copy-model", (params) => { copy_model(params); });

	// Start the client. This will also launch the server.
	client.start();
}

// Sleep for the number of seconds
async function sleep(time_ms: number) {
	return new Promise(resolve => setTimeout(resolve, time_ms));
}

export function restart(initial: boolean = false): Thenable<void> | undefined {
	if (initial && client == undefined)
		console.log("Starting ImandraX LSP server");
	else {
		clientRestarts += 1;
		console.log(`Restarting Imandrax LSP server (attempt ${clientRestarts})`);
		client.sendRequest("shutdown", null); // Try to shut down gracefully.
		client.stop();

		window.activeTextEditor.setDecorations(decoration_type_good, []);
		window.activeTextEditor.setDecorations(decoration_type_bad, []);

		sleep(500); // Give it a bit of time to avoid races on the log file.
	}
	return start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	console.log("Deactivating ImandraX LSP server");
	client.sendRequest("shutdown", null);
	const c = client;
	client = null;
	return c.stop();
}

export function check_all(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	const file_uri = window.activeTextEditor.document.uri;
	if (file_uri.scheme == "file")
		client.sendRequest("workspace/executeCommand", { "command": "check-all", "arguments": [file_uri.toString()] });
}

export function browse(uri: string): Thenable<boolean> | undefined {
	const config = workspace.getConfiguration("imandrax");
	if (config.useSimpleBrowser)
		return commands.executeCommand("simpleBrowser.api.open", uri);
	else
		return env.openExternal(uri as any);
}

export function toggle_full_ids(): Thenable<void> | undefined {
	showFullIDs = !showFullIDs;
	return client.sendNotification("workspace/didChangeConfiguration", { "settings": { "show-full-ids": showFullIDs } });
}

function create_terminal(cwd) {
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

function interact_model(params) {
	const config = workspace.getConfiguration("imandrax");

	const uri = Uri.parse(params["uri"]);
	const models = params["models"];

	const wsf = workspace.getWorkspaceFolder(uri);

	let cwd;
	let filename;

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

function copy_model(params) {
	const models = params["models"];
	let str = "";
	models.join();
	models.forEach(async m => {
		str += m;
	});
	env.clipboard.writeText(str);
}

function clear_cache() {
	client.sendRequest("workspace/executeCommand", { "command": "clear-cache", "arguments": [] });
	return true;
}