import { commands, ConfigurationTarget, ExtensionContext, window, workspace } from 'vscode';

const ARG_SETTINGS = ['lsp.arguments', 'terminal.arguments'] as const;

/** The one managed argument. MUST be given a ws(s):// URL: with an http(s)
    URL the CLI dials the host with its internal raw-TCP transport instead of
    the scheduler websocket, which self-hosted servers do not speak. */
const ENDPOINT_FLAG = '--server-endpoint';

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

/** Strip the managed endpoint argument (either `--server-endpoint=URL` or
    `--server-endpoint URL`); all other args are left alone. */
function withoutEndpointArg(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === ENDPOINT_FLAG) {
      i++;
      continue;
    }
    if (arg.startsWith(ENDPOINT_FLAG + '=')) {
      continue;
    }
    out.push(arg);
  }
  return out;
}

function endpointFromArgs(args: string[] | undefined): string | undefined {
  if (args === undefined) {
    return undefined;
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(ENDPOINT_FLAG + '=')) {
      return args[i].slice(ENDPOINT_FLAG.length + 1);
    }
    if (args[i] === ENDPOINT_FLAG) {
      return args[i + 1];
    }
  }
  return undefined;
}

/** Rewrite one scope's args. Uses inspect() so only the target scope's own
    value is edited — get() would return the merged view and leak one scope's
    args into the other. A connect seeds an absent value from the effective
    one (so a fresh workspace override keeps `lsp --check-on-save…`); a
    disconnect leaves absent values absent. */
async function updateArgSettings(
  target: ConfigurationTarget,
  wsUrl: string | undefined
): Promise<void> {
  const cfg = workspace.getConfiguration('imandrax');
  for (const key of ARG_SETTINGS) {
    const info = cfg.inspect<string[]>(key);
    const own = target === ConfigurationTarget.Workspace ? info?.workspaceValue : info?.globalValue;
    if (own === undefined && wsUrl === undefined) {
      continue; // nothing managed in this scope
    }
    const seed =
      own ??
      (target === ConfigurationTarget.Workspace ? info?.globalValue : undefined) ??
      info?.defaultValue ??
      [];
    const args = withoutEndpointArg(seed);
    if (wsUrl !== undefined) {
      args.push(`${ENDPOINT_FLAG}=${wsUrl}`);
    }
    await cfg.update(key, args, target);
  }
}

interface ScopePick {
  label: string;
  description: string;
  target: ConfigurationTarget;
}

async function pickScope(title: string): Promise<ScopePick | undefined> {
  const user: ScopePick = {
    label: 'User',
    description: 'All VS Code windows on this machine',
    target: ConfigurationTarget.Global,
  };
  if (workspace.workspaceFolders === undefined) {
    return user; // no workspace open: nothing to pick
  }
  const items: ScopePick[] = [
    user,
    {
      label: 'Workspace',
      description: 'This workspace only (shareable via .vscode/settings.json)',
      target: ConfigurationTarget.Workspace,
    },
  ];
  return window.showQuickPick(items, { title, ignoreFocusOut: true });
}

function currentBaseUrl(): string {
  const info = workspace.getConfiguration('imandrax').inspect<string[]>('lsp.arguments');
  const configured =
    endpointFromArgs(info?.workspaceValue) ?? endpointFromArgs(info?.globalValue);
  return configured !== undefined ? (baseUrlFromScheduler(configured) ?? '') : '';
}

async function configure(): Promise<void> {
  const input = await window.showInputBox({
    title: 'Self-hosted ImandraX server',
    prompt: "Base URL of the server, e.g. `http://my-vm:8086`. Leave empty to disconnect and use Imandra's cloud.",
    value: currentBaseUrl(),
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
    await updateArgSettings(scope.target, undefined);
    window.showInformationMessage(`ImandraX now uses Imandra's cloud (${scope.label.toLowerCase()} settings).`);
    return;
  }

  await updateArgSettings(scope.target, schedulerUrl(new URL(trimmed)));
  let message =
    `ImandraX now uses the self-hosted server at ${trimmed} ` +
    `(via ${ENDPOINT_FLAG} in imandrax.lsp.arguments and imandrax.terminal.arguments, ${scope.label.toLowerCase()} settings).`;
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
    commands.registerCommand('imandrax.configure_self_hosted_server', () => configure())
  );
}
