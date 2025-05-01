import * as commands from './commands/commands';
import * as decorations from './decorations';
import * as formatter from './formatter';
import * as imandraxLanguageClient from './imandrax_language_client/imandrax_language_client';
import * as installer from './installer';
import * as listeners from './listeners';

import {
  env,
  ExtensionContext,
  ExtensionMode,
  Uri,
  window,
  workspace,
  TextEditorDecorationType
} from "vscode";

import {
  LanguageClient,
} from "vscode-languageclient/node";


export async function activate(context: ExtensionContext) {
  const languageClientConfig = imandraxLanguageClient.configuration.get();

  if (imandraxLanguageClient.configuration.isFoundPath(languageClientConfig)) {
    const languageClientWrapper_ = new imandraxLanguageClient.ImandraxLanguageClient(languageClientConfig);
    const getClient: () => LanguageClient = () => { return languageClientWrapper_.getClient(); };

    formatter.register();

    commands.registration.register(context, languageClientWrapper_);

    decorations.initialize(context);

    const listenersInstance = new listeners.Listeners(context, getClient);
    listenersInstance.register();
    if (context.extensionMode === ExtensionMode.Test || context.extensionMode === undefined) {
      (global as any).testListeners = listenersInstance;
    }

    workspace.onDidChangeConfiguration(event => {
      languageClientWrapper_.update_configuration(context.extensionUri, event);
    });

    await languageClientWrapper_.start({ extensionUri: context.extensionUri });

    if (context.extensionMode === ExtensionMode.Test || context.extensionMode === undefined) {
      (global as any).testLanguageClientWrapper = languageClientWrapper_;
    }
  }
  else if (languageClientConfig.binPathAvailability.status === "missingPath") {
    const args = { revealSetting: { key: "imandrax.lsp.binary", edit: true } };
    const openUri = Uri.parse(
      `command:workbench.action.openWorkspaceSettingsFile?${encodeURIComponent(JSON.stringify(args))}`
    );
    await installer.promptToInstall(openUri);
  } else if (languageClientConfig.binPathAvailability.status === "onWindows") {
    const item = { title: "Go to docs" };
    const itemT = await window.showErrorMessage(`ImandraX can't run natively on Windows. Please start a remote VSCode session against WSL`, item);
    if (itemT?.title === item.title) {
      await env.openExternal(await env.asExternalUri(Uri.parse("https://code.visualstudio.com/docs/remote/wsl-tutorial")));
    }
  }
  if (context.extensionMode === ExtensionMode.Test || context.extensionMode === undefined) {
    (global as any).testExtensionContext = context;
  }
}
