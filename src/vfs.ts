import * as lsp_client from './lsp_client';

import { EventEmitter, TextDocumentContentProvider, Uri } from 'vscode';


export class VFSContentProvider implements TextDocumentContentProvider {
  onDidChangeEmitter = new EventEmitter<Uri>();
  onDidChange = this.onDidChangeEmitter.event;

  async provideTextDocumentContent(uri: Uri): Promise<string> {
    if (uri.authority == undefined || uri.authority == "") {
      const fst = uri.path.split("/");
      const auth = (fst[0] == "") ? fst[1] : fst[0];
      uri = uri.with({ authority: auth });
    }
    return await lsp_client.client.sendRequest<string>("$imandrax/req-vfs-file", { "uri": uri });
  }
}

export const vfs_provider: VFSContentProvider = new VFSContentProvider();