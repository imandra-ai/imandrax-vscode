import * as commands_ from './commands';
import * as decorations from './decorations';
import * as environment from './environment';
import * as installer from './installer';
import * as listeners from './listeners';
import * as lsp_client from './lsp_client';

import {
  ExtensionContext,
  languages,
  Range,
  TextDocument,
  TextEdit,
  Uri,
  window,
  workspace
} from "vscode";

import {
  LanguageClient,
} from "vscode-languageclient/node";

import CP = require('child_process');

let extensionUri : Uri | undefined = undefined;

const lspConfig = environment.getEnv();
const lspClient = new lsp_client.LspClient(lspConfig);
const getClient: () => LanguageClient = () => { return lspClient.getClient(); };

export async function activate(context: ExtensionContext) {
  console.log("activate()");
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
    extensionUri = context;

    // Register formatter
    languages.registerDocumentFormattingEditProvider("imandrax", {
      provideDocumentFormattingEdits(document: TextDocument): TextEdit[] {
        const config = workspace.getConfiguration("imandrax");
        const cmd_args: string[] = config.lsp.formatter;
        if (!cmd_args || cmd_args.length == 0)
          return [];
        else {
          const out = CP.execSync(cmd_args.join(" ") + " " + document.fileName);
          const rng = new Range(0, 0, document.lineCount, 0);
          document.validateRange(rng);
          return [TextEdit.replace(rng, out.toString())];
        }
      }
    });

    commands_.register(context, lspClient);

    decorations.initialize(context);

    const listenersInstance = new listeners.Listeners(context, getClient);
    listenersInstance.register();

    workspace.onDidChangeConfiguration(event => {
      lspClient.update_configuration(extensionUri, event);
    });

    lspClient.start({ extensionUri: extensionUri });
  }
}


