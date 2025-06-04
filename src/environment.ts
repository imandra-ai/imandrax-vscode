import * as Which from "which";
import {
  env,
  workspace
} from "vscode";

interface PlatformConfiguration {
  onWindows: boolean;
  inRemoteWsl: boolean;
}

interface ImandraXLspConfiguration {
  serverArgs,
  mergedEnv,
  binAbsPath: BinAbsPath,
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

function getBinAbsPath(platform_configuration: PlatformConfiguration, binary: string): BinAbsPath {
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

function getPlatformConfiguration(): PlatformConfiguration {
  const onWindows = process.platform === "win32";
  const inRemoteWsl = env.remoteName === "wsl";

  return { onWindows, inRemoteWsl };
}

export function getEnv(): ImandraXLspConfiguration {
  const config = workspace.getConfiguration("imandrax");
  const binary = config.lsp.binary;
  const serverArgs = config.lsp.arguments;
  const serverEnv = config.lsp.environment;

  const systemEnv = process.env;
  const mergedEnv = Object.assign(systemEnv, serverEnv);

  const platformConfiguration = getPlatformConfiguration();

  const binAbsPath = getBinAbsPath(platformConfiguration, binary);

  return { serverArgs, mergedEnv, binAbsPath };
}
