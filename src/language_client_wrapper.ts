import * as commands from './commands/commands';
import * as decorations from './decorations';
import * as vfsProvider from './vfs_provider';

import { ConfigurationChangeEvent, ExtensionContext, ExtensionMode, Uri, window, workspace } from 'vscode';
import { Executable, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/node';

import { FoundPathConfig } from './language_client_configuration';


const MAX_RESTARTS: number = 10;

export interface RestartParams {
  extensionUri: Uri
}

async function sleep(time_ms: number) {
  return new Promise(resolve => setTimeout(resolve, time_ms));
}

export class LanguageClientWrapper {
  private readonly serverOptions: Executable;
  private client!: LanguageClient;
  private readonly vfsProvider_: vfsProvider.VFSContentProvider;
  private restartCount = 0;
  private isInitial = () => { return this.client === undefined; };

  getRestartCount(context: ExtensionContext) {
    if (context.extensionMode === ExtensionMode.Test) {
      return this.restartCount;
    }
  }

  getClient() {
    return this.client;
  }

  getVfsProvider() {
    return this.vfsProvider_;
  }

  constructor(languageClientConfig: FoundPathConfig) {
    this.serverOptions = {
      command: languageClientConfig.binPathAvailability.path,
      args: languageClientConfig.serverArgs,
      options: { env: languageClientConfig.mergedEnv }
    };
    this.vfsProvider_ = new vfsProvider.VFSContentProvider(() => { return this.getClient(); });
  }

  // Start language server
  async start(params: { extensionUri: Uri }): Promise<void> {
    if (this.isInitial()) {
      console.log("Starting ImandraX LSP server");
    }
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
      (params) => { commands.interact_model(params); });
    this.client.onRequest("$imandrax/copy-model",
      (params) => { commands.copy_model(params); });
    this.client.onRequest("$imandrax/visualize-decomp",
      (params) => { commands.visualize_decomp(extensionUri, params); });
    this.client.onNotification("$imandrax/vfs-file-changed",
      async (params) => {
        const uri = Uri.parse(params["uri"]);
        this.vfsProvider_.onDidChangeEmitter.fire(uri);
      });

    // Start the client. This will also launch the server.
    this.client.start().catch(ex => { console.log(`Exception thrown while starting LSP client/server: ${ex}`); }).then(
      _ => { this.update_configuration(extensionUri, undefined); }
    );
  }

  async restart(params: RestartParams) {
    if (!this.isInitial()) {
      this.restartCount += 1;
      console.log(`Restarting Imandrax LSP server (attempt ${this.restartCount})`);

      // Try to shut down gracefully.
      if (this.client && this.client.isRunning()) {
        await this.client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));
      }
      this.client = undefined!;

      window.activeTextEditor?.setDecorations(decorations.decoration_type_good, []);
      window.activeTextEditor?.setDecorations(decorations.decoration_type_bad, []);

      sleep(500); // Give it a bit of time to avoid races on the log file.
    }
    return this.start({ extensionUri: params.extensionUri });
  }

  deactivate(): Thenable<void> | undefined {
    if (!this.client) {
      return undefined;
    }
    console.log("Deactivating ImandraX LSP server");
    if (this.client.isRunning()) {
      this.client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));
    }
  }

  update_configuration(extensionUri: Uri, event: ConfigurationChangeEvent | undefined) {
    if (event === undefined || event.affectsConfiguration('imandrax')) {
      const client = this.client;
      if (event && (
        event.affectsConfiguration('imandrax.lsp.binary') ||
        event.affectsConfiguration('imandrax.lsp.arguments') ||
        event.affectsConfiguration('imandrax.lsp.environment'))) {
        this.restart({ extensionUri: extensionUri });
      }

      if (client && client.isRunning()) {
        const config = workspace.getConfiguration("imandrax");
        return client.sendNotification("workspace/didChangeConfiguration", {
          "settings":
          {
            "show-full-ids": commands.showFullIds,
            "goal-state-show-proven": config.lsp.showProvenGoals
          }
        });
      }
    }
  }
}
