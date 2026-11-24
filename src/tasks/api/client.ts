import { Disposable, workspace } from 'vscode';
import type { Client } from 'imandrax-api';
import type { Task } from 'imandrax-api/dist/tasks';
import * as apiKey from '../../api_key';

export const TIMEOUT_MS = 300_000;

export const errorText = (e: unknown) => `ImandraX API: ${e instanceof Error ? e.message : String(e)}`;

// Connections to the server of `imandrax.experimental.apiUrl` ('' = Imandra's hosted server): one per use,
// closed after it (a failed close is ignored). A task's artifacts outlive the session that ran it.
export class ApiSession implements Disposable {
  // Fetches on a task, chained: each sets the task's client (the last PO's task serves both the DB and its report)
  private readonly queues = new WeakMap<Task, Promise<unknown>>();
  // Stops the fetches running and queued
  private readonly disposed = new AbortController();

  // `f` with a new connection; `signal` aborts connecting
  async use<T>(signal: AbortSignal, f: (client: Client) => Promise<T>): Promise<T> {
    const client = await connect(signal);
    try {
      return await f(client);
    } finally {
      await close(client);
    }
  }

  // `f` (which uses `task`) after the task's earlier fetches, with a new connection as the task's client,
  // within TIMEOUT_MS; `what` names it in the timeout error
  fetch<T>(task: Task, what: string, f: () => Promise<T>): Promise<T> {
    let work: Promise<T> | undefined;
    const run = (this.queues.get(task) ?? Promise.resolve()).then(async () => {
      const stop = new AbortController();
      const stopped = new Promise<never>((_, reject) => {
        stop.signal.addEventListener('abort', () => { reject(stop.signal.reason as Error); });
      });
      const timer = setTimeout(() => { stop.abort(new Error(`timed out loading ${what}`)); }, TIMEOUT_MS);
      const onDispose = () => { stop.abort(new Error(`stopped loading ${what}`)); };
      this.disposed.signal.addEventListener('abort', onDispose);
      if (this.disposed.signal.aborted) { onDispose(); }
      try {
        return await Promise.race([stopped, (async () => {
          const client = await connect(stop.signal);
          try {
            stop.signal.throwIfAborted(); // stopped while connecting: the next fetch may have the task
            task.setClient(client);
            return await (work = f());
          } finally {
            void close(client); // a hung close must not hold up the result or the next fetch
          }
        })()]);
      } finally {
        clearTimeout(timer);
        this.disposed.signal.removeEventListener('abort', onDispose);
      }
    });
    // A stopped `f` may still be fetching (the task's requests take no signal): the next fetch waits for it,
    // ponytail: but at most SETTLE_MS, then a hung `f` may overlap it
    this.queues.set(task, run.catch(() => undefined).then(() => work && settled(work)));
    return run;
  }

  dispose() { this.disposed.abort(); }
}

const SETTLE_MS = 30_000;

// `p` settled, or SETTLE_MS passed
const settled = (p: Promise<unknown>) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, SETTLE_MS);
  void p.catch(() => undefined).then(() => { clearTimeout(timer); resolve(); });
});

async function connect(signal: AbortSignal) {
  const key = await apiKey.get();
  if (!key) { throw new Error('no API key: set IMANDRA_API_KEY or write ~/.config/imandrax/api_key'); }
  const { Client } = await import('imandrax-api'); // only loaded when a task runs
  const url = workspace.getConfiguration('imandrax').get<string>('experimental.apiUrl');
  return Client.connect({ url: url === '' ? undefined : url, apiKey: key, signal });
}

const close = (client: Client) => client.close().catch(() => undefined);
