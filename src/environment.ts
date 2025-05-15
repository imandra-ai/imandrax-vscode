import Which = require('which');
import {
  env,
  workspace,
  WorkspaceConfiguration
} from "vscode";

export interface PlatformConfiguration {
  onWindows: boolean;
  inRemoteWsl: boolean;
}

export interface ImandraXLspConfiguration {
  config: WorkspaceConfiguration,
  binary: string,
  server_args,
  server_env,
  system_env: NodeJS.ProcessEnv,
  merged_env,
  bin_abs_path: BinAbsPath,
  platform_configuration: PlatformConfiguration
}

export type BinAbsPath =
  | {
    status: "foundPath"
    path: string
  }
  | {
    status: "onWindows"
  }
  | {
    status: "missingPath"
  }

function get_bin_abs_path(platform_configuration: PlatformConfiguration, binary: string): BinAbsPath {
  if ((!platform_configuration.onWindows)
    || (platform_configuration.onWindows && platform_configuration.inRemoteWsl)) {
    const path = Which.sync(binary, { nothrow: true });
    if (path != "" && path != null) {
      return { status: "foundPath", path };
    }
    else {
      return { status: "missingPath" };
    }
  } else {
    return { status: "onWindows" };
  }
}

function get_platform_configuration(): PlatformConfiguration {
  const onWindows = process.platform === 'win32';
  const inRemoteWsl = env.remoteName === 'wsl';

  return { onWindows, inRemoteWsl };
}

export function get_env(): ImandraXLspConfiguration {
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