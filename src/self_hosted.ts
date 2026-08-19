import * as fs from 'fs';
import * as Path from 'path';
import { homedir } from 'os';

import { commands, ConfigurationTarget, ExtensionContext, window, workspace } from 'vscode';

const CONFIG_FILENAME = 'vscode-self-hosted-server.json';
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

/** NOT globalStorage: on macOS that path contains a space ("Application
    Support") and released imandrax-cli wrapper scripts word-split their
    arguments (unquoted $@), mangling any spacey path. ~/.config/imandrax
    (also home of the api_key file) is space-free for typical users. */
function configPath(): string {
  return Path.join(homedir(), '.config', 'imandrax', CONFIG_FILENAME);
}

/** Where earlier builds of this command kept the config; still cleaned up. */
function legacyConfigPath(context: ExtensionContext): string {
  return Path.join(context.globalStorageUri.fsPath, 'self-hosted-server.json');
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

/** Strip any `-c <path>` pair this command manages (current or legacy
    location). Only managed paths are removed; a user's own `-c` args are
    left alone. */
function withoutManagedConfig(args: string[], managedPaths: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && managedPaths.includes(args[i + 1])) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

async function updateArgSettings(managedPaths: string[], connectPath: string | undefined): Promise<void> {
  const cfg = workspace.getConfiguration('imandrax');
  for (const key of ARG_SETTINGS) {
    const args = withoutManagedConfig(cfg.get<string[]>(key) ?? [], managedPaths);
    if (connectPath !== undefined) {
      args.push('-c', connectPath);
    }
    await cfg.update(key, args, ConfigurationTarget.Global);
  }
}

async function configure(context: ExtensionContext): Promise<void> {
  const cfgPath = configPath();
  const legacyPath = legacyConfigPath(context);
  const managedPaths = [cfgPath, legacyPath];

  const input = await window.showInputBox({
    title: 'Self-hosted ImandraX server',
    prompt: "Base URL of the server, e.g. `http://my-vm:8086`. Leave empty to disconnect and use Imandra's cloud.",
    value: currentBaseUrl(cfgPath) ?? currentBaseUrl(legacyPath) ?? '',
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
    await updateArgSettings(managedPaths, undefined);
    for (const p of managedPaths) {
      try { fs.rmSync(p); } catch { /* already gone */ }
    }
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
  try { fs.rmSync(legacyPath); } catch { /* never existed */ }
  await updateArgSettings(managedPaths, cfgPath);
  window.showInformationMessage(
    `ImandraX now uses the self-hosted server at ${trimmed} (via '-c' in imandrax.lsp.arguments and imandrax.terminal.arguments).`
  );
}

export function register(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('imandrax.configure_self_hosted_server', () => configure(context))
  );
}
