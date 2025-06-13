import * as commands from './commands/commands';
import * as decorations from './decorations';
import * as formatter from './formatter';
import * as installer from './installer';
import * as languageClientConfiguration from './language_client_configuration';
import * as languageClientWrapper from './language_client_wrapper';
import * as listeners from './listeners';

import {
  ExtensionContext,
  ExtensionMode,
  Uri,
  window,
  workspace
} from "vscode";

import {
  LanguageClient,
} from "vscode-languageclient/node";


export async function activate(context: ExtensionContext) {
  const languageClientConfig = languageClientConfiguration.get();

  if (languageClientConfiguration.isFoundPath(languageClientConfig)) {
    const languageClientWrapper_ = new languageClientWrapper.LanguageClientWrapper(languageClientConfig);
    const getClient: () => LanguageClient = () => { return languageClientWrapper_.getClient(); };

    formatter.register();

    commands.register.f(context, languageClientWrapper_);

    decorations.initialize(context);

    const listenersInstance = new listeners.Listeners(context, getClient);
    listenersInstance.register();

    workspace.onDidChangeConfiguration(event => {
      languageClientWrapper_.update_configuration(context.extensionUri, event);
    });

    await languageClientWrapper_.start({ extensionUri: context.extensionUri });

    if (context.extensionMode === ExtensionMode.Test) {
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
    window.showErrorMessage(`ImandraX can't run natively on Windows. Please start a remote VSCode session against WSL.`);
  }

  if (context.extensionMode === ExtensionMode.Test) {
    (global as any).testExtensionContext = context;
  }
}
