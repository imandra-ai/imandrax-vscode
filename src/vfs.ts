import { TextDocumentContentProvider, EventEmitter, Uri, ExtensionContext, workspace } from 'vscode';
import { client } from './lsp_client';

export class VFSContentProvider implements TextDocumentContentProvider {
	onDidChangeEmitter = new EventEmitter<Uri>();
	onDidChange = this.onDidChangeEmitter.event;

	async provideTextDocumentContent(uri: Uri): Promise<string> {
		if (uri.authority == undefined || uri.authority == "") {
			const fst = uri.path.split("/");
			const auth = (fst[0] == "") ? fst[1] : fst[0];
			uri = uri.with({ authority: auth });
		}
		return await client.sendRequest<string>("$imandrax/req-vfs-file", { "uri": uri });
	}
}

/** Single VFS provider */
export const vfs_provider: VFSContentProvider = new VFSContentProvider();

/** Register the VFS */
export function activate(context: ExtensionContext) {
	context.subscriptions.push(workspace.registerTextDocumentContentProvider("imandrax-vfs", vfs_provider));
}
