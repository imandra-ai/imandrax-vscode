import * as commands from '../commands/commands';
import * as decorations from '../decorations';
import * as util from '../util';
import * as vfsProvider from '../vfs_provider';

import { FoundPathConfig } from './configuration';

import { ConfigurationChangeEvent, ExtensionContext, ExtensionMode, Uri, window, workspace, WorkspaceConfiguration } from 'vscode';
import { Executable, LanguageClient, LanguageClientOptions, State } from 'vscode-languageclient/node';


export * as configuration from './configuration';


const MAX_RESTARTS = 10;

export interface RestartParams {
  extensionUri: Uri
}

export class ImandraxLanguageClient {
  private readonly serverOptions: Executable;
  private client!: LanguageClient;
  private readonly vfsProvider_: vfsProvider.VFSContentProvider;
  private restartCount = 0;
  private isInitial = () => { return this.client === undefined; };

  getRestartCount(context: ExtensionContext) {
    if (context?.extensionMode === ExtensionMode.Test) {
      return this.restartCount;
    }
  }

  getClient() {
    return this.client;
  }

  getVfsProvider() {
    return this.vfsProvider_;
  }

  // see https://github.com/clangd/vscode-clangd/pull/587
  clientIsReady() {
    return this.client && this.client.state === State.Running;
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
    const was_initial = this.isInitial();
    if (was_initial) {
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

    if (was_initial) {
      this.client.onRequest("$imandrax/interact-model",
        (params) => { commands.interact_model(params); });
      this.client.onRequest("$imandrax/copy-model",
        (params) => { commands.copy_model(params); });
      this.client.onRequest("$imandrax/visualize-decomp",
        (params) => { commands.visualize_decomp(extensionUri, params); });
      this.client.onNotification("$imandrax/vfs-file-changed",
        (params) => {
          const uri = Uri.parse(params["uri"]);
          this.vfsProvider_.onDidChangeEmitter.fire(uri);
        });
    }

    // Start the client. This will also launch the server.
    await this.client.start().catch(ex => { console.log(`Exception thrown while starting LSP client/server: ${ex}`); }).then(
      async () => { await this.update_configuration(extensionUri, undefined); }
    );
  }

  async restart(params: RestartParams) {
    if (!this.isInitial()) {

      this.restartCount += 1;
      console.log(`Restarting Imandrax LSP server (attempt ${this.restartCount})`);

      // Try to shut down gracefully.
      if (this.client?.isRunning()) {
        await this.client.stop().catch(ex => console.log(`Exception thrown while stopping LSP client/server: ${ex}`));
      }
      this.client = undefined!;

      window.activeTextEditor?.setDecorations(decorations.decoration_type_good, []);
      window.activeTextEditor?.setDecorations(decorations.decoration_type_bad, []);

      await util.sleep(500); // Give it a bit of time to avoid races on the log file.
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

  async update_configuration(extensionUri: Uri, event: ConfigurationChangeEvent | undefined) {
    if (event === undefined || event.affectsConfiguration('imandrax')) {
      const client = this.client;
      if (event && (
        event.affectsConfiguration('imandrax.lsp.binary') ||
        event.affectsConfiguration('imandrax.lsp.arguments') ||
        event.affectsConfiguration('imandrax.lsp.environment'))) {
        await this.restart({ extensionUri: extensionUri });
      }

      if (client?.isRunning()) {
        const config: WorkspaceConfiguration = workspace.getConfiguration("imandrax");
        return client.sendNotification("workspace/didChangeConfiguration", {
          "settings":
          {
            "show-full-ids": commands.showFullIds,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            "goal-state-show-proven": config.lsp.showProvenGoals
          }
        });
      }
    }
  }
}
