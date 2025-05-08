import {
	workspace,
	window,
	ExtensionContext,
	commands,
	env,
	Uri,
	TerminalOptions,
	Range,
	TextDocument,
	TextDocumentContentProvider,
	TextEdit,
	languages,
	DiagnosticChangeEvent,
	DecorationOptions,
	DecorationRenderOptions,
	DiagnosticSeverity,
	TextEditor,
	StatusBarAlignment,
	ThemeColor,
	StatusBarItem,
	EventEmitter,
	ViewColumn,
	ConfigurationChangeEvent
} from "vscode";


import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
} from "vscode-languageclient/node";

import CP = require('child_process');
import Path = require('path');
import Which = require('which');

import * as ixcommands from './commands';
import * as vfs from './vfs';
import { sleep } from './utils';

const MAX_RESTARTS: number = 10;

export let client: LanguageClient = undefined;
export let clientRestarts: number = 0;
export let decoration_type_good = undefined;
export let decoration_type_bad = undefined;

export async function start(params: { extensionUri: Uri }) {
	const { extensionUri } = params;

	// Start language server
	const config = workspace.getConfiguration("imandrax");
	const binary = config.lsp.binary;
	const server_args = config.lsp.arguments;
	const server_env = config.lsp.environment;

	const system_env = process.env;
	const merged_env = Object.assign(system_env, server_env);

	const bin_abs_path = Which.sync(binary, { nothrow: true });
	if (!bin_abs_path) {
		const args = { revealSetting: { key: 'imandrax.lsp.binary', edit: true } };
		const openUri = Uri.parse(
			`command:workbench.action.openWorkspaceSettingsFile?${encodeURIComponent(JSON.stringify(args))}`
		);
		window.showErrorMessage(`Could not find ImandraX. Please ensure the imandrax-cli binary is in your PATH or its location is set in the [Workspace Settings](${openUri})`);
	}
	else {
		const serverOptions: Executable = { command: bin_abs_path, args: server_args, options: { env: merged_env } };

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

		client.onRequest("$imandrax/interact-model", (params) => { ixcommands.interact_model(params); });

		client.onRequest("$imandrax/copy-model", (params) => { ixcommands.copy_model(params); });

		client.onRequest("$imandrax/visualize-decomp", (params) => { ixcommands.visualize_decomp(extensionUri, params); });

		client.onNotification("$imandrax/vfs-file-changed", async (params) => {
			const uri = Uri.parse(params["uri"]);
			vfs.vfs_provider.onDidChangeEmitter.fire(uri);
		});

		// Start the client. This will also launch the server.
		client.start().catch(ex => { console.log(`Exception thrown while starting LSP client/server: ${ex}`); }).then(
			_ => { update_configuration(extensionUri, undefined); }
		);
	}
}

export interface RestartParams {
	initial: boolean;
	extensionUri: Uri
}

export async function restart(params: RestartParams) {
	if (params.initial && client == undefined)
		console.log("Starting ImandraX LSP server");
	else {
		clientRestarts += 1;
		console.log(`Restarting Imandrax LSP server (attempt ${clientRestarts})`);

		// Try to shut down gracefully.
		if (client && client.isRunning())
			await client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));

		client = undefined;

		window.activeTextEditor.setDecorations(decoration_type_good, []);
		window.activeTextEditor.setDecorations(decoration_type_bad, []);

		sleep(500); // Give it a bit of time to avoid races on the log file.
	}
	return start({extensionUri: params.extensionUri});
}

export function update_configuration(extensionUri: Uri, event: ConfigurationChangeEvent | undefined): Promise<void> {
	if (event == undefined || event.affectsConfiguration('imandrax')) {
		if (event && event.affectsConfiguration('imandrax.lsp.binary'))
			restart({ initial: client == undefined, extensionUri });

		if (client && client.isRunning()) {
			const config = workspace.getConfiguration("imandrax");
			return client.sendNotification("workspace/didChangeConfiguration", {
				"settings":
				{
					"show-full-ids": ixcommands.showFullIDs,
					"goal-state-show-proven": config.lsp.showProvenGoals
				}
			});
		}
	}
}


export function activate(context: ExtensionContext) {
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
