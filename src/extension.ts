import * as commands_ from './commands';
import * as decorations from './decorations';
import * as environment from './environment';
import * as formatter from './formatter';
import * as installer from './installer';
import * as listeners from './listeners';
import * as lsp_client from './lsp_client';

import {
  ExtensionContext,
  Uri,
  window,
  workspace
} from "vscode";

import {
  LanguageClient,
} from "vscode-languageclient/node";


export async function activate(context: ExtensionContext) {
  const lspConfig = environment.getEnv();
  const lspClient = new lsp_client.LspClient(lspConfig);
  const getClient: () => LanguageClient = () => { return lspClient.getClient(); };

  const env = environment.getEnv();

  if (env.binAbsPath.status === "missingPath") {
    const args = { revealSetting: { key: "imandrax.lsp.binary", edit: true } };
    const openUri = Uri.parse(
      `command:workbench.action.openWorkspaceSettingsFile?${encodeURIComponent(JSON.stringify(args))}`
    );
    await installer.promptToInstall(openUri);
  } else if (env.binAbsPath.status === "onWindows") {
    window.showErrorMessage(`ImandraX can't run natively on Windows. Please start a remote VSCode session against WSL.`);
  } else {
    formatter.register();

    commands_.register(context, lspClient);

    decorations.initialize(context);

    const listenersInstance = new listeners.Listeners(context, getClient);
    listenersInstance.register();

    workspace.onDidChangeConfiguration(event => {
      lspClient.update_configuration(context.extensionUri, event);
    });

    lspClient.start({ extensionUri: context.extensionUri });
  }
}


