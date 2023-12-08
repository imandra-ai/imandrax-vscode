import { inspect } from 'util';
import { workspace, ExtensionContext, commands } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

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

	const executable_options = { command: binary, args: server_args, env: server_env /* transport: TransportKind.stdio */ };
	const serverOptions: ServerOptions = executable_options;

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'imandrax' }],
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

export function restart(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	console.log("restarting imandrax lsp server");
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
