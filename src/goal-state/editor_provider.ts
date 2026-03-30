import {
  CancellationToken,
  CustomDocumentEditEvent,
  CustomReadonlyEditorProvider,
  EventEmitter,
  ExtensionContext,
  Disposable,
  Uri,
  Webview,
  WebviewPanel,
  window,
  workspace,
} from "vscode";

import { disposeAll } from './dispose';
import { cancellable } from './cancellation';
import { GoalStateDocument } from "./document";
import * as EditorMessages from "./editor_messages";

const inDebugMode = process.env.VSCODE_DEBUG_MODE === 'true';

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class GoalStateEditorProvider implements CustomReadonlyEditorProvider<GoalStateDocument> {

  public static register(context: ExtensionContext): Disposable {
    const provider = new GoalStateEditorProvider(context);
    return window.registerCustomEditorProvider(GoalStateEditorProvider.viewType, provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { enableFindWidget: true }
      });
  }

  public static readonly viewType = "imandrax.GoalState";

  constructor(
    private readonly _context: ExtensionContext
  ) { }

  static activePanel: WebviewPanel | undefined = undefined;
  static activeDocument: GoalStateDocument | undefined = undefined;

  async openCustomDocument(
    uri: Uri,
    openContext: { backupId?: string },
    cancelToken: CancellationToken
  ): Promise<GoalStateDocument> {
    return cancellable(GoalStateDocument.create(uri, openContext.backupId, {
      getFileData: async () => {
        if (GoalStateEditorProvider.activePanel) {
          // Get stuff from the panel, e.g. to save it to disk.
          return new Promise(() => { new Uint8Array() });
        }
        else
          throw new Error("No webview panel");
      }
    }).then(document => {
      const listeners: Disposable[] = [];

      listeners.push(document.onDidChange(e => {
        // Tell VS Code that the document has been edited by the user.
        this._onDidChangeCustomDocument.fire({
          document,
          ...e,
        });
      }));

      listeners.push(document.onDidChangeDocument(e => {
        // Update all webviews when the document content changes
        if (GoalStateEditorProvider.activePanel) {
          this.postMessage(GoalStateEditorProvider.activePanel, {
            type: "update",
            body: { content: e.content },
          });
        }
      }));

      document.onDidDispose(() => {
        disposeAll(listeners);
      });

      return document;
    }), cancelToken);
  }

  public resolveCustomEditor(
    document: GoalStateDocument,
    webviewPanel: WebviewPanel,
    cancelToken: CancellationToken
  ): void {
    if (!cancelToken.isCancellationRequested) {
      webviewPanel.webview.options = {
        enableScripts: true,
        enableCommandUris: true,
      };
      webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
      webviewPanel.webview.onDidReceiveMessage(async (msg: EditorMessages.Incoming) => await this.onMessage(document, msg));
      GoalStateEditorProvider.activePanel = webviewPanel;
      GoalStateEditorProvider.activeDocument = document;
    }
  }

  private readonly _onDidChangeCustomDocument = new EventEmitter<CustomDocumentEditEvent<GoalStateDocument>>();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  private getHtmlForWebview(webview: Webview): string {
    const exturi = this._context.extensionUri;
    const scriptUri = webview.asWebviewUri(Uri.joinPath(
      exturi, "media", "goal_state.js")).toString();

    const styleResetUri = webview.asWebviewUri(Uri.joinPath(
      exturi, "media", "reset.css")).toString();

    const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(
      exturi, "media", "vscode.css")).toString();

    const codiconsUri = webview.asWebviewUri(Uri.joinPath(
      exturi, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')).toString();

    const styleMainUri = webview.asWebviewUri(Uri.joinPath(
      exturi, "media", "goal_state.css")).toString();

    const logoUri = webview.asWebviewUri(Uri.joinPath(
      exturi, "assets", "imandra-smile.png")).toString();

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();

    return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
        <link href="${codiconsUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />

				<title>Goal State</title>
			</head>
			<body>
        <h1>Goal State</h1>
        <img class="logo" src="${logoUri}" alt="Logo">

        <p>&nbsp;</p>

        <p>
          <div class="goal-state-content"/>
        </p>

        <script nonce="${nonce}" src="${scriptUri}"/>
			</body>
			</html>`;
  }

  private postMessage(panel: WebviewPanel, msg: EditorMessages.Outgoing): void {
    panel.webview.postMessage(msg);
  }

  private async onMessage(document: GoalStateDocument, msg: EditorMessages.Incoming) {
    if (inDebugMode)
      console.log(`onMessage: ${JSON.stringify(msg)}`)

    switch (msg.command) {
      case "ready":
        if (GoalStateEditorProvider.activePanel) {
          if (document.uri.scheme === "untitled") {
            this.postMessage(GoalStateEditorProvider.activePanel, {
              type: "init",
              body: {
                untitled: true,
                editable: true,
              }
            });
          } else {
            this.postMessage(GoalStateEditorProvider.activePanel, {
              type: "init",
              body: {
                value: document.documentData,
                editable: workspace.fs.isWritableFileSystem(document.uri.scheme)
              }
            });
          }
        }
        break;
      case "jump-to": {
        await document.jump_to(msg.arguments.uri, msg.arguments.options, msg.arguments.location);
        break;
      }
      case "expand": {
        const args = msg.arguments;
        await document.expand(args.id, args.anchor);
        break;
      }
      case "focus-lock-onto": {
        document.focusLockOnto(msg.arguments.anchor);
        break;
      }
      case "resize": {
        await document.resize(msg.arguments.width, msg.arguments.font_size);
        break;
      }
      case "jump-to-declaration": {
        await document.jump_to_declaration(msg.arguments.name);
        break;
      }
    }
  }
}