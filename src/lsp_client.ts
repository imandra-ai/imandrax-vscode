import * as commands_ from './commands';
import * as extension_ from './extension_';
import * as installer from './installer';
import * as vfs from './vfs';

import { Executable, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/node';
import { Uri, window, workspace } from 'vscode';
import { getEnv } from './environment';


const MAX_RESTARTS: number = 10;

export let client: LanguageClient = undefined;
export let clientRestarts: number = 0;
export const decoration_type_good = undefined;
export const decoration_type_bad = undefined;

export async function start(params: { extensionUri: Uri }) {
  const { extensionUri } = params;
  // Start language server
  const env = getEnv();

  if (env.binAbsPath.status === "missingPath") {
    const args = { revealSetting: { key: "imandrax.lsp.binary", edit: true } };
    const openUri = Uri.parse(
      `command:workbench.action.openWorkspaceSettingsFile?${encodeURIComponent(JSON.stringify(args))}`
    );

    await installer.promptToInstall(openUri);
  }
  else if (env.binAbsPath.status === "onWindows") {
    window.showErrorMessage(`ImandraX can't run natively on Windows. Please start a remote VSCode session against WSL.`);
  }
  else {
    const serverOptions: Executable = { command: env.binAbsPath.path, args: env.serverArgs, options: { env: env.mergedEnv } };

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

    client.onRequest("$imandrax/interact-model", (params) => { commands_.interact_model(params); });

    client.onRequest("$imandrax/copy-model", (params) => { commands_.copy_model(params); });

    client.onRequest("$imandrax/visualize-decomp", (params) => { commands_.visualize_decomp(extensionUri, params); });

    client.onNotification("$imandrax/vfs-file-changed", async (params) => {
      const uri = Uri.parse(params["uri"]);
      vfs.vfs_provider.onDidChangeEmitter.fire(uri);
    });

    // Start the client. This will also launch the server.
    client.start().catch(ex => { console.log(`Exception thrown while starting LSP client/server: ${ex}`); }).then(
      _ => { extension_.update_configuration(extensionUri, undefined); }
    );
  }
}

export interface RestartParams {
  initial: boolean;
  extensionUri: Uri
}

// Sleep for the number of seconds
async function sleep(time_ms: number) {
  return new Promise(resolve => setTimeout(resolve, time_ms));
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
  return start({ extensionUri: params.extensionUri });
}

