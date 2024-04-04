import { workspace, window, ExtensionContext, commands, CancellationTokenSource, env, Uri } from 'vscode';

import {
	Executable,
	ExecutableOptions,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	VersionedTextDocumentIdentifier,
} from 'vscode-languageclient/node';

const MAX_RESTARTS: number = 10;

let numManualRestarts: number = 0;
let client: LanguageClient;

export function activate(context: ExtensionContext) {
	console.log("activating imandrax lsp");

	// Register commands
	const restart_cmd = 'imandrax.restart_language_server';
	const restart_handler = () => { restart(); };
	context.subscriptions.push(commands.registerCommand(restart_cmd, restart_handler));

	const check_all_cmd = 'imandrax.check_all';
	const check_all_handler = () => { check_all(); };
	context.subscriptions.push(commands.registerCommand(check_all_cmd, check_all_handler));

	const browse_cmd = 'imandrax.browse';
	const browse_handler = (uri) => { browse(uri); };
	context.subscriptions.push(commands.registerCommand(browse_cmd, browse_handler));

	// Start language server
	const config = workspace.getConfiguration('imandrax');
	const binary = config.lsp.binary;
	const server_args = config.lsp.arguments;
	const server_env = config.lsp.environment;

	const system_env = process.env;
	const merged_env = Object.assign(system_env, server_env);

	const serverOptions: Executable = { command: binary, args: server_args, options: { env: merged_env } /* transport: TransportKind.stdio */ };

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'imandrax' }],
		stdioEncoding: 'utf-8',
		connectionOptions: {
			maxRestartCount: MAX_RESTARTS,
		},
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/*.iml')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'imandrax_lsp',
		'ImandraX LSP',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	console.log(`starting client`);
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

	console.log(`restarting imandrax lsp server (attempt ${numManualRestarts})`);
	return client.restart();
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

export function browse(uri : string): Thenable<boolean> | undefined {
	return env.openExternal(uri as any);
}