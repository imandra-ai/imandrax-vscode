
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Disposable, Event, EventEmitter, FileChangeEvent, FilePermission, FileStat, FileSystemProvider, FileType, FileSystemError, Uri } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export class VFSProvider implements FileSystemProvider {
  private readonly _getClient: () => LanguageClient;

  constructor(getClient: () => LanguageClient) {
    this._getClient = getClient;
  }

  onDidChangeEmitter = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this.onDidChangeEmitter.event;

  private _get_from_vfs(uri: Uri): Promise<string> {
    if (uri.authority === undefined || uri.authority === "") {
      const fst = uri.path.split("/");
      const auth = (fst[0] === "") ? fst[1] : fst[0];
      uri = uri.with({ authority: auth });
    }
    return this._getClient().sendRequest<string>("$imandrax/req-vfs-file", { "uri": uri });
  }

  private file_stats = new Map<Uri, FileStat>();

  watch(uri: Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): Disposable {
    return new Disposable(() => {
      // A disposable that tells the provider to stop watching the uri.
     });
  }

  stat(uri: Uri): Thenable<FileStat> {
    let fs = this.file_stats.get(uri);
    if (!fs) {
      return this.readFile(uri).then((_x) => {
        fs = this.file_stats.get(uri);
        if (!fs)
          throw FileSystemError.FileNotFound(uri);
        else
          return fs;
      });
    }
    else
      return Promise.resolve(fs);
  }

  readDirectory(uri: Uri): [string, FileType][] | Thenable<[string, FileType][]> {
    throw new Error('Method not implemented.');
  }

  createDirectory(uri: Uri): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }

  readFile(uri: Uri): Thenable<Uint8Array> {
    return this._get_from_vfs(uri)
      .then((fs) => {
        this.file_stats.set(uri, { type: FileType.File, ctime: Date.now(), mtime: Date.now(), size: fs.length, permissions: FilePermission.Readonly });
        return new TextEncoder().encode(fs);
      })
      .catch(e => {
        throw FileSystemError.FileNotFound(uri);
      });
  }

  writeFile(uri: Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }

  delete(uri: Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }

  rename(oldUri: Uri, newUri: Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }

  copy?(source: Uri, destination: Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
    throw new Error('Method not implemented.');
  }
}
