import * as commands_ from './commands';
import * as vfs_provider from './vfs_provider';

import { Executable, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/node';
import { Uri, window, workspace } from 'vscode';


const MAX_RESTARTS: number = 10;

// export let client: LanguageClient = undefined;
export let clientRestarts: number = 0;
export const decoration_type_good = undefined;
export const decoration_type_bad = undefined;

export interface RestartParams {
  initial: boolean;
  extensionUri: Uri
}

// Sleep for the number of seconds
async function sleep(time_ms: number) {
  return new Promise(resolve => setTimeout(resolve, time_ms));
}

export class LspClient {
  private readonly serverOptions: Executable;
  private client: LanguageClient;
  private readonly vfsProvider: vfs_provider.VFSContentProvider;

  getClient() {
    return this.client;
  }

  getVfsProvider() {
    return this.vfsProvider;
  }

  constructor(lspClientConfig) {
    this.serverOptions = {
      command: lspClientConfig.binAbsPath.path,
      args: lspClientConfig.serverArgs,
      options: { env: lspClientConfig.mergedEnv }
    };
    this.vfsProvider = new vfs_provider.VFSContentProvider(this.getClient);
  }

  // Start language server
  async start(params: { extensionUri: Uri }): Promise<void> {
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
    this.client = new LanguageClient(
      "imandrax_lsp",
      "ImandraX LSP",
      this.serverOptions,
      clientOptions
    );

    const { extensionUri } = params;

    this.client.onRequest("$imandrax/interact-model",
      (params) => { commands_.interact_model(params); });
    this.client.onRequest("$imandrax/copy-model",
      (params) => { commands_.copy_model(params); });
    this.client.onRequest("$imandrax/visualize-decomp",
      (params) => { commands_.visualize_decomp(extensionUri, params); });
    this.client.onNotification("$imandrax/vfs-file-changed",
      async (params) => {
        const uri = Uri.parse(params["uri"]);
        this.vfsProvider.onDidChangeEmitter.fire(uri);
      });

    // Start the client. This will also launch the server.
    this.client.start().catch(ex => { console.log(`Exception thrown while starting LSP client/server: ${ex}`); }).then(
      _ => { this.update_configuration(extensionUri, undefined); }
    );
  }

  async restart(params: RestartParams) {
    if (params.initial && this.client == undefined)
      console.log("Starting ImandraX LSP server");
    else {
      clientRestarts += 1;
      console.log(`Restarting Imandrax LSP server (attempt ${clientRestarts})`);

      // Try to shut down gracefully.
      if (this.client && this.client.isRunning())
        await this.client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));

      this.client = undefined;

      window.activeTextEditor.setDecorations(decoration_type_good, []);
      window.activeTextEditor.setDecorations(decoration_type_bad, []);

      sleep(500); // Give it a bit of time to avoid races on the log file.
    }
    return this.start({ extensionUri: params.extensionUri });
  }

  deactivate(): Thenable<void> | undefined {
    if (!this.client) {
      return undefined;
    }
    console.log("Deactivating ImandraX LSP server");
    if (this.client.isRunning())
      this.client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));
  }

  update_configuration(extensionUri: Uri, event): Promise<void> {
    if (event == undefined || event.affectsConfiguration('imandrax')) {
      const client = this.client;
      if (event && (
        event.affectsConfiguration('imandrax.lsp.binary') ||
        event.affectsConfiguration('imandrax.lsp.arguments') ||
        event.affectsConfiguration('imandrax.lsp.environment')))
        this.restart({ initial: client == undefined, extensionUri: extensionUri });

      if (client && client.isRunning()) {
        const config = workspace.getConfiguration("imandrax");
        return client.sendNotification("workspace/didChangeConfiguration", {
          "settings":
          {
            "show-full-ids": commands_.showFullIDs,
            "goal-state-show-proven": config.lsp.showProvenGoals
          }
        });
      }
    }
  }
}
