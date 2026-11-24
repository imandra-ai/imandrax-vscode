import { workspace } from 'vscode';
import type { Client } from 'imandrax-api';
import type { Task } from 'imandrax-api/dist/tasks';
import * as apiKey from '../../api_key';

export const TIMEOUT_MS = 300_000;

export const errorText = (e: unknown) => `ImandraX API: ${e instanceof Error ? e.message : String(e)}`;

// Connections to the server of `imandrax.experimental.apiUrl` ('' = Imandra's hosted server): one per use,
// closed after it (a failed close is ignored). A task's artifacts outlive the session that ran it.
export class ApiSession {
  // Fetches on a task, chained: each sets the task's client (the last PO's task serves both the DB and its report)
  private readonly queues = new WeakMap<Task, Promise<unknown>>();

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
    const run = (this.queues.get(task) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const timedOut = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => { reject(new Error(`timed out loading ${what}`)); }, { once: true });
      });
      timedOut.catch(() => undefined); // also when connect fails first
      const client = await Promise.race([connect(signal), timedOut]);
      try {
        task.setClient(client);
        return await Promise.race([f(), timedOut]);
      } finally {
        void close(client); // a hung close must not hold up the result or the next fetch
      }
    });
    this.queues.set(task, run);
    return run;
  }
}

async function connect(signal: AbortSignal) {
  const key = await apiKey.get();
  if (!key) { throw new Error('no API key: set IMANDRA_API_KEY or write ~/.config/imandrax/api_key'); }
  const { Client } = await import('imandrax-api'); // only loaded when a task runs
  const url = workspace.getConfiguration('imandrax').get<string>('experimental.apiUrl');
  return Client.connect({ url: url === '' ? undefined : url, apiKey: key, signal });
}

const close = (client: Client) => client.close().catch(() => undefined);
