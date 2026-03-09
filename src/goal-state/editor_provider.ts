import {
  CancellationToken,
  CustomDocumentBackup,
  CustomDocumentBackupContext,
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

import { GoalStateDocument } from "./document";
import * as EditorMessages from "./editor_messages";

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

  private _panel: WebviewPanel | undefined = undefined;

  async openCustomDocument(
    uri: Uri,
    openContext: { backupId?: string },
    _token: CancellationToken
  ): Promise<GoalStateDocument> {
    const document: GoalStateDocument = await GoalStateDocument.create(uri, openContext.backupId, {
      getFileData: async () => {
        if (this._panel) {
          // Get stuff from the panel, e.g. to save it to disk.
          return new Promise(() => { new Uint8Array() });
        }
        else
          throw new Error("No webview panel");
      }
    });

    const listeners: Disposable[] = [];

    listeners.push(document.onDidChange(e => {
      // Tell VS Code that the document has been edited by the user.
      this._onDidChangeCustomDocument.fire({
        document,
        ...e,
      });
    }));

    listeners.push(document.onDidChangeDocument(e => {
      // Update all webviews when the document changes
      if (this._panel) {
        this.postMessage(this._panel, "update", {
          content: e.content,
        });
      }
    }));

    document.onDidDispose(() => { /* TODO */ });

    return document;
  }

  public async resolveCustomEditor(
    document: GoalStateDocument,
    webviewPanel: WebviewPanel,
    _token: CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage(async (msg: EditorMessages.Message) => await this.onMessage(document, msg));

    this._panel = webviewPanel;
  }

  private readonly _onDidChangeCustomDocument = new EventEmitter<CustomDocumentEditEvent<GoalStateDocument>>();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  public saveCustomDocument(document: GoalStateDocument, cancellation: CancellationToken): Thenable<void> {
    return document.save(cancellation);
  }

  public saveCustomDocumentAs(document: GoalStateDocument, destination: Uri, cancellation: CancellationToken): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(document: GoalStateDocument, cancellation: CancellationToken): Thenable<void> {
    return document.revert(cancellation);
  }

  public backupCustomDocument(document: GoalStateDocument, context: CustomDocumentBackupContext, cancellation: CancellationToken): Thenable<CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

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

				<title>Goal State Terminal</title>
			</head>
			<body>
        <img class="logo" src="${logoUri}" alt="Logo">

        <h1>Goal State</h1>
        <p>Perhaps a little subtitle.</p>

        <p>&nbsp;</p>

        <p>
          <div class="goal-state-content"/>
        </p>

        <script nonce="${nonce}" src="${scriptUri}"/>
			</body>
			</html>`;
  }

  private _requestId = 1;
  private readonly _callbacks = new Map<number, (response: any) => void>();

  private postMessage(panel: WebviewPanel, type: string, body: any): void {
    panel.webview.postMessage({ type, body });
  }

  private async onMessage(document: GoalStateDocument, msg: EditorMessages.Message) {
    console.log(`onMessage: ${JSON.stringify(msg)}`)

    switch (msg.command) {
      case "ready":
        if (this._panel) {
          if (document.uri.scheme === "untitled") {
            this.postMessage(this._panel, "init", {
              untitled: true,
              editable: true
            });
          } else {
            this.postMessage(this._panel, "init", {
              value: document.documentData,
              editable: workspace.fs.isWritableFileSystem(document.uri.scheme)
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
        await document.expand(args.id, args.po_anchor);
        break;
      }
    }
  }
}