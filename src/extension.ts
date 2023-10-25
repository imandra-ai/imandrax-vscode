import { inspect } from 'util';
import { workspace, ExtensionContext } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	console.log("activating imandrax lsp");

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const executable = { command: "imandrax_lsp", args: ["--check-on-save=true"] /* transport: TransportKind.stdio */ };
	const executableDebug = { ...executable, args: [...executable.args, "--debug-lsp", "--debug-file=/tmp/lsp.log"] };
	const serverOptions: ServerOptions = {
		run: executable,
		debug: executableDebug
	};

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

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	console.log("deactivating imandrax lsp");
	const c = client;
	client = null;
	return c.stop();
}
