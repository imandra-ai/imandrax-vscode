import Which = require("which");
import {
  env,
  workspace,
  WorkspaceConfiguration
} from "vscode";

interface PlatformConfiguration {
  onWindows: boolean;
  inRemoteWsl: boolean;
}

interface ImandraXLspConfiguration {
  config: WorkspaceConfiguration,
  binary: string,
  serverArgs,
  serverEnv,
  systemEnv: NodeJS.ProcessEnv,
  mergedEnv,
  binAbsPath: BinAbsPath,
  platformConfiguration: PlatformConfiguration
}

type BinAbsPath =
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
  const onWindows = process.platform === "win32";
  const inRemoteWsl = env.remoteName === "wsl";

  return { onWindows, inRemoteWsl };
}

export function get_env(): ImandraXLspConfiguration {
  const config = workspace.getConfiguration("imandrax");
  const binary = config.lsp.binary;
  const serverArgs = config.lsp.arguments;
  const serverEnv = config.lsp.environment;

  const systemEnv = process.env;
  const mergedEnv = Object.assign(systemEnv, serverEnv);

  const platformConfiguration = get_platform_configuration();

  const binAbsPath = get_bin_abs_path(platformConfiguration, binary);

  return { config, binary, serverArgs, serverEnv, systemEnv, mergedEnv, binAbsPath, platformConfiguration };
}