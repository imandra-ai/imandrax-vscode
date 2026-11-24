import { Disposable, Progress, ProgressLocation, window, workspace } from 'vscode';
import type { Client, DecomposeOptions, DecompositionResult } from 'imandrax-api';
import type { DecompositionTask } from 'imandrax-api/dist/tasks';
import * as apiKey from '../../api_key';

export const TIMEOUT_MS = 300_000;

export const errorText = (e: unknown) => `ImandraX API: ${e instanceof Error ? e.message : String(e)}`;

type Reporter = Progress<{ message?: string }>;

// A decomposition as sent: the file's text then, and `name`, decomposed by the file's `[@@decomp]` attribute
// (loading the file with `taskFilter`), or else by a plain `decompose` with `options`
export class DecompRequest {
  options?: DecomposeOptions; // once sent as a plain decompose

  constructor(readonly src: string, readonly name: string, readonly taskFilter?: readonly string[]) { }

  // Sends it with `client`; undefined if the file has errors, after showing them
  async send(client: Client, signal: AbortSignal, progress: Reporter): Promise<DecompositionResult | undefined> {
    progress.report({ message: 'loading file' });
    // Loading the file also runs its `[@@decomp ...]` attributes with their options (~assuming, ~prune, ...)
    const ev = await client.evalSrc(this.src, { taskFilter: this.taskFilter, signal, timeoutMs: TIMEOUT_MS });
    // evalSrc reports success even with errors, and a decompose after that hangs, so stop here
    if (ev.errors.length) { void window.showErrorMessage(`ImandraX: ${ev.errors[0].toString()}`); return; }
    progress.report({ message: 'decomposing' });
    const attribute = this.options ? undefined : ev.decompResults.find(r => r.decomposition?.id.shortName === this.name);
    if (attribute) { return attribute; }
    // A function without the attribute (e.g. picked from the palette) gets a plain decomposition
    this.options ??= { prune: true, stringResults: true };
    return client.decompose(this.name, { ...this.options, signal, timeoutMs: TIMEOUT_MS });
  }
}

// A decomposition's task and the client of the session that ran it, left open (until end()) to fetch the task's
// artifacts in. A new client reopening the session (Client.connect with `sessionId`) can reach a server that
// doesn't know it (InvalidSession, a third of the time on dev); this one keeps its routing.
export class DecompTask {
  ended = false;
  onReplaced?: () => void;

  constructor(public task: DecompositionTask, private client: Client, readonly request: DecompRequest) { }

  get sessionId() { return this.client.sessionId; }

  // Throws if the server no longer has the session; else keeps it from expiring
  alive(signal: AbortSignal) { return this.client.keepSessionAlive({ signal }); }

  // `request` sent again: its task and session replace these, whose session ends
  replace(task: DecompositionTask, client: Client) {
    void close(this.client);
    [this.task, this.client] = [task, client];
    if (this.ended) { void close(client); }
    this.onReplaced?.();
  }

  end() { this.ended = true; void close(this.client); }
}

// Connections to the server of `imandrax.experimental.apiUrl` ('' = Imandra's hosted server). A decomposition's
// session stays open while its task is listed (the server may drop a task's data with its session); fetches
// use it, and if the server forgot it (or the task), decompose again in a new session.
// ponytail: kept alive by fetches only, so a session the server expires when idle costs a new decomposition
export class ApiSession implements Disposable {
  // Fetches on a task, chained
  private readonly queues = new WeakMap<DecompTask, Promise<unknown>>();
  // Stops the fetches running and queued
  private readonly disposed = new AbortController();

  // `request` sent in a new session (`signal` aborts it), kept open as the result's DecompTask if it has a task;
  // undefined if the file has errors
  async decompose(request: DecompRequest, signal: AbortSignal, progress: Reporter) {
    const client = await connect(signal);
    let source: DecompTask | undefined;
    try {
      const res = await request.send(client, signal, progress);
      source = res?.task && new DecompTask(res.task, client, request);
      return res && { res, source };
    } finally {
      if (!source) { await close(client); }
    }
  }

  // `f` on the task after its earlier fetches, within TIMEOUT_MS (again for a decomposition sent again); `what`
  // names it in errors. `f` runs in the task's session; if the server no longer has that or the task's artifacts,
  // the decomposition is sent again in a new session (with progress) and `f` runs on its task
  fetch<T>(source: DecompTask, what: string, f: (task: DecompositionTask) => Promise<T>): Promise<T> {
    let work: Promise<T> | undefined;
    const run = (this.queues.get(source) ?? Promise.resolve()).then(async () => {
      const stop = new AbortController();
      const stopped = new Promise<never>((_, reject) => {
        stop.signal.addEventListener('abort', () => { reject(stop.signal.reason as Error); });
      });
      let timer: NodeJS.Timeout | undefined;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { stop.abort(new Error(`timed out loading ${what}`)); }, TIMEOUT_MS);
      };
      arm();
      const onDispose = () => { stop.abort(new Error(`stopped loading ${what}`)); };
      this.disposed.signal.addEventListener('abort', onDispose);
      if (this.disposed.signal.aborted) { onDispose(); }
      try {
        return await Promise.race([stopped, (async () => {
          try {
            await source.alive(stop.signal);
            return await (work = f(source.task)); // the task's client is the session's
          } catch (e) {
            if (stop.signal.aborted || source.ended || !await gone(e)) { throw e; }
          }
          arm();
          return await (work = f(await this.resend(source, stop)));
        })()]);
      } finally {
        clearTimeout(timer);
        this.disposed.signal.removeEventListener('abort', onDispose);
      }
    });
    // A stopped `f` may still be fetching (the task's requests take no signal): the next fetch waits for it,
    // ponytail: but at most SETTLE_MS, then a hung `f` may overlap it
    this.queues.set(source, run.catch(() => undefined).then(() => work && settled(work)));
    return run;
  }

  dispose() { this.disposed.abort(); }

  // `source`'s decomposition sent again in a new session, which replaces its own; cancelling the progress stops `stop`.
  // Tasks are content-addressed, so this is normally the same task (the view says if not)
  private resend(source: DecompTask, stop: AbortController) {
    const { name } = source.request;
    const options = { location: ProgressLocation.Notification, title: `Decomposing ${name} again (the server no longer has it)`, cancellable: true };
    return window.withProgress(options, async (progress, token) => {
      token.onCancellationRequested(() => { stop.abort(new Error(`cancelled decomposing ${name} again`)); });
      const client = await connect(stop.signal);
      try {
        const res = await source.request.send(client, stop.signal, progress);
        if (!res?.task) { throw new Error(`decomposing ${name} again failed${res ? `: ${res.errors.map(String).join('\n')}` : ''}`); }
        stop.signal.throwIfAborted();
        source.replace(res.task, client);
        return res.task;
      } catch (e) {
        void close(client);
        throw e;
      }
    });
  }
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

// Ends the session
const close = (client: Client) => client.close().catch(() => undefined);

// The server no longer has the session (keepSessionAlive says "InvalidSession", other calls "Session not found": only
// the message tells, and imandrax-api's isSessionNotFound is internal) or the task's artifacts (get_artifact says
// "Invalid Task ID" as a server error)
async function gone(e: unknown) {
  const { ServerError, TwirpError } = await import('imandrax-api');
  return e instanceof ServerError
    || (e instanceof TwirpError && (e.code === 'not_found' || /Session not found|Unknown session|InvalidSession/.test(e.msg)));
}
