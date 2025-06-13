import * as commands from './commands/commands';
import * as decorations from './decorations';
import * as formatter from './formatter';
import * as installer from './installer';
import * as language_client_configuration from './language_client_configuration';
import * as language_client_wrapper from './language_client_wrapper';
import * as listeners from './listeners';

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
  const languageClientConfig = language_client_configuration.get();

  if (language_client_configuration.isFoundPath(languageClientConfig)) {
    const languageClientWrapper = new language_client_wrapper.LanguageClientWrapper(languageClientConfig);
    const getClient: () => LanguageClient = () => { return languageClientWrapper.getClient(); };

    formatter.register();

    commands.register.f(context, languageClientWrapper);

    decorations.initialize(context);

    const listenersInstance = new listeners.Listeners(context, getClient);
    listenersInstance.register();

    workspace.onDidChangeConfiguration(event => {
      languageClientWrapper.update_configuration(context.extensionUri, event);
    });

    await languageClientWrapper.start({ extensionUri: context.extensionUri });
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

  if (process.env.NODE_ENV === 'test') {
    (global as any).testExtensionContext = context;
  }
}
