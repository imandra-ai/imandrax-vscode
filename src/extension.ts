import { time } from 'console';
import { workspace, ExtensionContext, commands } from 'vscode';

import {
	Executable,
	ExecutableOptions,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';

const MAX_RESTARTS: number = 10;

let numManualRestarts: number = 0;
let client: LanguageClient;

export function activate(context: ExtensionContext) {
	console.log("activating imandrax lsp");

	// Register commands
	const command = 'imandrax.restart_language_server';
	const commandHandler = () => { restart(); };
	context.subscriptions.push(commands.registerCommand(command, commandHandler));

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
