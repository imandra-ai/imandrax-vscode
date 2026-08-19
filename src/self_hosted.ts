import * as fs from 'fs';
import * as Path from 'path';

import { commands, ConfigurationTarget, ExtensionContext, window, workspace } from 'vscode';

const CONFIG_FILENAME = 'self-hosted-server.json';
const ARG_SETTINGS = ['lsp.arguments', 'terminal.arguments'] as const;

/** The task scheduler websocket URL of a self-hosted server: its base URL
    with a ws(s) scheme and the /proto/ws path
    (e.g. http://my-vm:8086 -> ws://my-vm:8086/proto/ws). */
export function schedulerUrl(server: URL): string {
  const ws = new URL(server.toString());
  ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
  ws.pathname = (ws.pathname.endsWith('/') ? ws.pathname : ws.pathname + '/') + 'proto/ws';
  return ws.toString();
}

/** Inverse of `schedulerUrl`, for prefilling the input box. */
export function baseUrlFromScheduler(wsUrl: string): string | undefined {
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = url.pathname.replace(/\/proto\/ws\/?$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function configPath(context: ExtensionContext): string {
  return Path.join(context.globalStorageUri.fsPath, CONFIG_FILENAME);
}

function currentBaseUrl(cfgPath: string): string | undefined {
  try {
    const cfg: unknown = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const ws = (cfg as { net?: { 'remote-scheduler-url'?: string } }).net?.['remote-scheduler-url'];
    return ws ? baseUrlFromScheduler(ws) : undefined;
  } catch {
    return undefined;
  }
}

/** Strip any `-c <cfgPath>` pair this command previously added. Only the
    managed path is removed; a user's own `-c` args are left alone. */
function withoutManagedConfig(args: string[], cfgPath: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && args[i + 1] === cfgPath) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

async function updateArgSettings(cfgPath: string, connect: boolean): Promise<void> {
  const cfg = workspace.getConfiguration('imandrax');
  for (const key of ARG_SETTINGS) {
    const args = withoutManagedConfig(cfg.get<string[]>(key) ?? [], cfgPath);
    if (connect) {
      args.push('-c', cfgPath);
    }
    await cfg.update(key, args, ConfigurationTarget.Global);
  }
}

async function configure(context: ExtensionContext): Promise<void> {
  const cfgPath = configPath(context);

  const input = await window.showInputBox({
    title: 'Self-hosted ImandraX server',
    prompt: "Base URL of the server, e.g. `http://my-vm:8086`. Leave empty to disconnect and use Imandra's cloud.",
    value: currentBaseUrl(cfgPath) ?? '',
    ignoreFocusOut: true,
    validateInput: value => {
      const trimmed = value.trim();
      if (trimmed === '') {
        return undefined;
      }
      try {
        const url = new URL(trimmed);
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? undefined
          : 'Must be an http(s) URL.';
      } catch {
        return 'Not a valid URL.';
      }
    },
  });
  if (input === undefined) { // cancelled
    return;
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    await updateArgSettings(cfgPath, false);
    try { fs.rmSync(cfgPath); } catch { /* already gone */ }
    window.showInformationMessage("ImandraX now uses Imandra's cloud.");
    return;
  }

  const url = new URL(trimmed);
  const config = {
    net: {
      'remote-scheduler-url': schedulerUrl(url),
      // Self-hosted servers are unauthenticated; 'local' makes the CLI
      // proceed without an auth token instead of fetching a cloud one.
      deployment: 'local',
    },
  };
  try {
    fs.mkdirSync(Path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
  } catch (ex) {
    void window.showErrorMessage(`Could not write the self-hosted server config file: ${String(ex)}`);
    return;
  }
  await updateArgSettings(cfgPath, true);
  window.showInformationMessage(
    `ImandraX now uses the self-hosted server at ${trimmed} (via '-c' in imandrax.lsp.arguments and imandrax.terminal.arguments).`
  );
}

export function register(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('imandrax.configure_self_hosted_server', () => configure(context))
  );
}
