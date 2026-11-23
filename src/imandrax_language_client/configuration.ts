import * as Which from "which";
import {
  ExtensionContext,
  ExtensionMode,
} from "vscode";

import { getExtensionConfig, taskBackend } from "../config";

import {
  env
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
  outputToConsole: boolean
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
    const path = Which.sync(binary, { nothrow: true });
    if (path !== "" && path !== null)
      return { status: "foundPath", path: binary };
    else
      return { status: "onWindows" };
  }
}

function getPlatformConfiguration(): PlatformConfiguration {
  const onWindows = process.platform === "win32";
  const inRemoteWsl = env.remoteName === "wsl";

  return { onWindows, inRemoteWsl };
}

export function get(context : ExtensionContext): ImandraXLanguageClientConfiguration | FoundPathConfig {
  const config = getExtensionConfig();
  const binary = config.lsp.binary;
  const args = config.lsp.arguments;
  // With the API running the tasks the server only type-checks and offers the lenses. Existing
  // `--check-on-*=X` / `--check-on-* X` are dropped, as Cmdliner may reject a repeated option.
  const checkOpt = /^--check-on-(open|save)(=|$)/;
  const serverArgs = taskBackend() === "lsp" ? args : [
    ...args.filter((a, i) => !checkOpt.test(a) && !(i > 0 && /^--check-on-(open|save)$/.test(args[i - 1]))),
    "--check-on-open=false", "--check-on-save=false"];
  const serverEnv = config.lsp.environment;

  const systemEnv = process.env;
  const mergedEnv = Object.assign(systemEnv, serverEnv);

  const platformConfiguration = getPlatformConfiguration();

  const binPathAvailability = getBinPathAvailability(platformConfiguration, binary);

  const outputToConsole = (context.extensionMode === ExtensionMode.Test);

  if (binPathAvailability.status === 'foundPath')
    return { serverArgs, mergedEnv, binPathAvailability: binPathAvailability, outputToConsole } as FoundPathConfig
  else
    return { serverArgs, mergedEnv, binPathAvailability: binPathAvailability, outputToConsole };
}
