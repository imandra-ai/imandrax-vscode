import { EventEmitter, TextDocumentContentProvider, Uri } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';


export class VFSContentProvider implements TextDocumentContentProvider {
  onDidChangeEmitter = new EventEmitter<Uri>();
  onDidChange = this.onDidChangeEmitter.event;
  private readonly client: LanguageClient;

  constructor(client: LanguageClient) {
    this.client = client;
  }

  async provideTextDocumentContent(uri: Uri): Promise<string> {
    if (uri.authority === undefined || uri.authority === "") {
      const fst = uri.path.split("/");
      const auth = (fst[0] === "") ? fst[1] : fst[0];
      uri = uri.with({ authority: auth });
    }
    return await this.client.sendRequest<string>("$imandrax/req-vfs-file", { "uri": uri });
  }
}
