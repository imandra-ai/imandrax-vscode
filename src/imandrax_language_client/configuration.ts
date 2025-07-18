import * as Which from "which";
import {
  env,
  workspace
} from "vscode";

interface PlatformConfiguration {
  onWindows: boolean;
  inRemoteWsl: boolean;
}

interface FoundPathInner {
  status: "foundPath"
  path: string
}

type BinPathAvailability =
  | FoundPathInner
  | {
    status: "onWindows"
  }
  | {
    status: "missingPath"
  }

export interface ImandraXLanguageClientConfiguration {
  serverArgs: string[],
  mergedEnv: object,
  binPathAvailability: BinPathAvailability,
}

export interface FoundPathConfig extends ImandraXLanguageClientConfiguration {
  binPathAvailability: FoundPathInner;
}

export function isFoundPath(
  cfg: ImandraXLanguageClientConfiguration
): cfg is FoundPathConfig {
  return cfg.binPathAvailability.status === "foundPath";
}

function getBinPathAvailability(platform_configuration: PlatformConfiguration, binary: string): BinPathAvailability {
  if ((!platform_configuration.onWindows)
    || (platform_configuration.onWindows && platform_configuration.inRemoteWsl)) {
    const path = Which.sync(binary, { nothrow: true });
    if (path !== "" && path !== null) {
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

export function get(): ImandraXLanguageClientConfiguration | FoundPathConfig {
  const config = workspace.getConfiguration("imandrax");
  const binary = config.lsp.binary;
  const serverArgs = config.lsp.arguments;
  const serverEnv = config.lsp.environment;

  const systemEnv = process.env;
  const mergedEnv = Object.assign(systemEnv, serverEnv);

  const platformConfiguration = getPlatformConfiguration();

  const binPathAvailability = getBinPathAvailability(platformConfiguration, binary);

  return binPathAvailability.status === 'foundPath' ? { serverArgs, mergedEnv, binPathAvailability: binPathAvailability } as FoundPathConfig : { serverArgs, mergedEnv, binPathAvailability: binPathAvailability };
}
