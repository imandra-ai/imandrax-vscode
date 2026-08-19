import * as fs from 'fs';
import * as Path from 'path';

import { ExtensionContext, window } from 'vscode';

import { getExtensionConfig } from './config';

let storageDir: string | undefined = undefined;
let lastWarnedUrl: string | undefined = undefined;

export function initialize(context: ExtensionContext) {
  storageDir = context.globalStorageUri.fsPath;
}

export function isConfigured(): boolean {
  return getExtensionConfig().serverUrl.trim() !== '';
}

/** The task scheduler websocket URL of a self-hosted server: its base URL
    with a ws(s) scheme and the /proto/ws path
    (e.g. http://my-vm:8086 -> ws://my-vm:8086/proto/ws). */
export function schedulerUrl(server: URL): string {
  const ws = new URL(server.toString());
  ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
  ws.pathname = (ws.pathname.endsWith('/') ? ws.pathname : ws.pathname + '/') + 'proto/ws';
  return ws.toString();
}

function warnOnce(url: string, message: string) {
  if (lastWarnedUrl !== url) {
    lastWarnedUrl = url;
    void window.showErrorMessage(message);
  }
}

function parseServerUrl(serverUrl: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    warnOnce(serverUrl, `Invalid imandrax.serverUrl '${serverUrl}'; using Imandra's cloud instead.`);
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    warnOnce(serverUrl, `imandrax.serverUrl must be an http(s) URL, got '${serverUrl}'; using Imandra's cloud instead.`);
    return undefined;
  }
  return url;
}

/** Extra imandrax-cli arguments pointing the LSP/terminal at the
    self-hosted server from imandrax.serverUrl; empty when unset.
    The scheduler websocket URL has no CLI flag, only the `net` section of
    a config file, so one is generated in the extension's global storage. */
export function extraCliArgs(): string[] {
  const serverUrl = getExtensionConfig().serverUrl.trim();
  if (serverUrl === '' || storageDir === undefined) {
    return [];
  }
  const url = parseServerUrl(serverUrl);
  if (url === undefined) {
    return [];
  }

  const config = {
    net: {
      'remote-scheduler-url': schedulerUrl(url),
      // Self-hosted servers are unauthenticated; 'local' makes the CLI
      // proceed without an auth token instead of fetching a cloud one.
      deployment: 'local',
    },
  };
  const configPath = Path.join(storageDir, 'self-hosted-server.json');
  try {
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (ex) {
    void window.showErrorMessage(`Could not write the self-hosted server config file: ${String(ex)}`);
    return [];
  }
  // Deliberately NOT --server-endpoint: passing it stops the CLI from
  // opening the scheduler websocket at all (verified against 0.0.x CLIs).
  return ['-c', configPath];
}
