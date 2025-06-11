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
  const languageClientWrapper = new language_client_wrapper.LanguageClientWrapper(languageClientConfig);
  const getClient: () => LanguageClient = () => { return languageClientWrapper.getClient(); };

  const env = language_client_configuration.get();

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

    commands.register.f(context, languageClientWrapper);

    decorations.initialize(context);

    const listenersInstance = new listeners.Listeners(context, getClient);
    listenersInstance.register();

    workspace.onDidChangeConfiguration(event => {
      languageClientWrapper.update_configuration(context.extensionUri, event);
    });

    languageClientWrapper.start({ extensionUri: context.extensionUri });
  }
}


