import * as fs from 'fs';
import * as Path from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';

import { commands, ConfigurationTarget, ExtensionContext, window, workspace } from 'vscode';

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
function configDir(): string {
  return Path.join(homedir(), '.config', 'imandrax');
}

function userConfigPath(): string {
  return Path.join(configDir(), 'vscode-self-hosted-server.json');
}

/** Workspace scope gets its own file (keyed by a stable hash of the first
    workspace folder) so a workspace-level server never changes what
    user-scoped windows connect to. */
function workspaceConfigPath(): string | undefined {
  const folder = workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    return undefined;
  }
  const hash = createHash('sha1').update(folder.uri.fsPath).digest('hex').slice(0, 8);
  return Path.join(configDir(), `vscode-self-hosted-server.${hash}.json`);
}

/** Where earlier builds of this command kept the config; still cleaned up. */
function legacyConfigPath(context: ExtensionContext): string {
  return Path.join(context.globalStorageUri.fsPath, 'self-hosted-server.json');
}

function currentBaseUrl(cfgPath: string | undefined): string | undefined {
  if (cfgPath === undefined) {
    return undefined;
  }
  try {
    const cfg: unknown = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const ws = (cfg as { net?: { 'remote-scheduler-url'?: string } }).net?.['remote-scheduler-url'];
    return ws ? baseUrlFromScheduler(ws) : undefined;
  } catch {
    return undefined;
  }
}

/** Strip any `-c <path>` pair this command manages (any scope's file, or the
    legacy location). Only managed paths are removed; a user's own `-c` args
    are left alone. */
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

/** Rewrite one scope's args. Uses inspect() so only the target scope's own
    value is edited — get() would return the merged view and leak one scope's
    args into the other. A connect seeds an absent value from the effective
    one (so a fresh workspace override keeps `lsp --check-on-save…`); a
    disconnect leaves absent values absent. */
async function updateArgSettings(
  target: ConfigurationTarget,
  managedPaths: string[],
  connectPath: string | undefined
): Promise<void> {
  const cfg = workspace.getConfiguration('imandrax');
  for (const key of ARG_SETTINGS) {
    const info = cfg.inspect<string[]>(key);
    const own = target === ConfigurationTarget.Workspace ? info?.workspaceValue : info?.globalValue;
    if (own === undefined && connectPath === undefined) {
      continue; // nothing managed in this scope
    }
    const seed =
      own ??
      (target === ConfigurationTarget.Workspace ? info?.globalValue : undefined) ??
      info?.defaultValue ??
      [];
    const args = withoutManagedConfig(seed, managedPaths);
    if (connectPath !== undefined) {
      args.push('-c', connectPath);
    }
    await cfg.update(key, args, target);
  }
}

interface ScopePick {
  label: string;
  description: string;
  target: ConfigurationTarget;
  file: string;
}

async function pickScope(title: string): Promise<ScopePick | undefined> {
  const wsFile = workspaceConfigPath();
  const user: ScopePick = {
    label: 'User',
    description: 'All VS Code windows on this machine',
    target: ConfigurationTarget.Global,
    file: userConfigPath(),
  };
  if (wsFile === undefined) {
    return user; // no workspace open: nothing to pick
  }
  const items: ScopePick[] = [
    user,
    {
      label: 'Workspace',
      description: 'This workspace only',
      target: ConfigurationTarget.Workspace,
      file: wsFile,
    },
  ];
  return window.showQuickPick(items, { title, ignoreFocusOut: true });
}

async function configure(context: ExtensionContext): Promise<void> {
  const legacyPath = legacyConfigPath(context);
  const managedPaths = [userConfigPath(), workspaceConfigPath(), legacyPath]
    .filter((p): p is string => p !== undefined);

  const input = await window.showInputBox({
    title: 'Self-hosted ImandraX server',
    prompt: "Base URL of the server, e.g. `http://my-vm:8086`. Leave empty to disconnect and use Imandra's cloud.",
    value:
      currentBaseUrl(workspaceConfigPath()) ??
      currentBaseUrl(userConfigPath()) ??
      currentBaseUrl(legacyPath) ??
      '',
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

  const scope = await pickScope(
    trimmed === '' ? 'Disconnect which settings scope?' : 'Where should this apply?'
  );
  if (scope === undefined) { // cancelled
    return;
  }

  if (trimmed === '') {
    await updateArgSettings(scope.target, managedPaths, undefined);
    const stale = scope.target === ConfigurationTarget.Global ? [scope.file, legacyPath] : [scope.file];
    for (const p of stale) {
      try { fs.rmSync(p); } catch { /* already gone */ }
    }
    window.showInformationMessage(`ImandraX now uses Imandra's cloud (${scope.label.toLowerCase()} settings).`);
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
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(scope.file, JSON.stringify(config, null, 2));
  } catch (ex) {
    void window.showErrorMessage(`Could not write the self-hosted server config file: ${String(ex)}`);
    return;
  }
  if (scope.target === ConfigurationTarget.Global) {
    try { fs.rmSync(legacyPath); } catch { /* never existed */ }
  }
  await updateArgSettings(scope.target, managedPaths, scope.file);

  let message =
    `ImandraX now uses the self-hosted server at ${trimmed} ` +
    `(via '-c' in imandrax.lsp.arguments and imandrax.terminal.arguments, ${scope.label.toLowerCase()} settings).`;
  if (
    scope.target === ConfigurationTarget.Global &&
    workspace.getConfiguration('imandrax').inspect<string[]>('lsp.arguments')?.workspaceValue !== undefined
  ) {
    message += ' Note: this workspace overrides imandrax.lsp.arguments, which takes precedence here.';
  }
  window.showInformationMessage(message);
}

export function register(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('imandrax.configure_self_hosted_server', () => configure(context))
  );
}
