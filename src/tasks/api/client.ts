import { workspace } from 'vscode';
import * as apiKey from '../../api_key';

export const TIMEOUT_MS = 300_000;

export const errorText = (e: unknown) => `ImandraX API: ${e instanceof Error ? e.message : String(e)}`;

// A new session on the server of `imandrax.experimental.apiUrl` ('' = Imandra's hosted server)
export async function connect(signal?: AbortSignal) {
  const key = await apiKey.get();
  if (!key) { throw new Error('no API key: set IMANDRA_API_KEY or write ~/.config/imandrax/api_key'); }
  const { Client } = await import('imandrax-api'); // only loaded when a task runs
  const url = workspace.getConfiguration('imandrax').get<string>('experimental.apiUrl');
  return Client.connect({ url: url === '' ? undefined : url, apiKey: key, signal });
}
