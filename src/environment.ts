import * as cp from 'child_process';
import Which = require('which');
import {
  env,
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

  const bin_abs_path = Which.sync(binary, { nothrow: true });

  const platform_configuration = get_platform_configuration();

  return { config, binary, server_args, server_env, system_env, merged_env, bin_abs_path, platform_configuration };
}