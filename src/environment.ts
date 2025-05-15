import * as cp from 'child_process';
import Which = require('which');
import {
  env,
  window,
  workspace,
  WorkspaceConfiguration
} from "vscode";

export interface PlatformConfiguration {
  onWindows: boolean;
  inRemoteWsl: boolean;
  hasWsl: boolean;
}

export interface env {
  config: WorkspaceConfiguration,
  binary,
  server_args,
  server_env,
  system_env: NodeJS.ProcessEnv,
  merged_env,
  bin_abs_path: string
  platform_configuration: PlatformConfiguration
}

function get_bin_abs_path(platform_configuration: PlatformConfiguration, binary): string {
  if ((!platform_configuration.onWindows)
    || (platform_configuration.onWindows && platform_configuration.inRemoteWsl)) {
    return Which.sync(binary, { nothrow: true });
  } else {
    const term = window.createTerminal({
      name: 'foo',
      hideFromUser: false
    });
    const out =
      (new TextDecoder()).decode(
        cp.execSync(`Get-ChildItem -Path "\\\\wsl.localhost\\Ubuntu\\home" -Recurse -Filter 'imandrax-cli' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName`,
          { shell: "powershell.exe" }));
    console.log(out);
    term.show();
    return binary;
  }
}

function get_platform_configuration(): PlatformConfiguration {

  // are we on windows?
  const onWindows = process.platform === 'win32';

  // is the extension host running in wsl?
  const inRemoteWsl = env.remoteName === 'wsl';

  // does windows have wsl?

  const hasWsl = (() => {
    if (!onWindows) { return false; }
    try {
      cp.execSync('wsl.exe --list --quiet', { stdio: 'ignore' });
      return true;
    }
    catch { return false; }
  })();
  return { onWindows, inRemoteWsl, hasWsl };
}

export function get_env(): env {
  const config = workspace.getConfiguration("imandrax");
  const binary = config.lsp.binary;
  const server_args = config.lsp.arguments;
  const server_env = config.lsp.environment;

  const system_env = process.env;
  const merged_env = Object.assign(system_env, server_env);

  const platform_configuration = get_platform_configuration();

  const bin_abs_path = get_bin_abs_path(platform_configuration, binary);

  return { config, binary, server_args, server_env, system_env, merged_env, bin_abs_path, platform_configuration };
}