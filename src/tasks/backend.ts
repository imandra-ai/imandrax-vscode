import { Disposable, Range, Uri } from 'vscode';

export type TaskKind = 'check' | 'decompose';

// What a task command runs on: a proof obligation (check) or function (decompose) symbol, without hash.
// From a server code lens it also carries that lens's original command, arguments and range; `kind` is
// the lens's task (absent for the server's own Cancel lenses).
export interface TaskTarget {
  readonly sym: string;
  readonly kind?: TaskKind;
  readonly lens?: { readonly command: string; readonly arguments: readonly unknown[]; readonly range: Range };
}

// A file's task counts, as the status bar shows them
export interface FileProgress {
  started: number;
  finished: number;
  successful: number;
  failed: number;
  total: number;
}

// Where decompositions run (setting `imandrax.experimental.taskBackend`): the language server or the
// ImandraX API. Checks always run on the language server. Tasks take the file's URI: the backend opens
// it if it needs the text.
export interface TaskBackend extends Disposable {
  // Without a target: a function the backend asks for, if it can
  decompose(uri: Uri, target?: TaskTarget): Promise<void>;
  // Without a target: every task the backend itself runs for the file (the language server backend has
  // none of its own, as the server has no cancel-all, and says so)
  cancel(uri: Uri, target?: TaskTarget): Promise<void>;
}
