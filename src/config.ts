import { workspace, ConfigurationTarget } from "vscode";

export interface Config {
  debugMode: boolean,
  lsp: {
    binary: string;
    arguments: string[];
    environment: object;
  },
  terminal: {
    binary: string;
    arguments: string[];
    freshModelModules: boolean;
  },
  useSimpleBrowser: boolean;
  IMLFormatter: boolean;
  largeDecompConfirmation: number;
  largeDecompConfirmationBytes: number;
  showProvenGoals: boolean;
  maximumGoalAge: number;
  hideDefaultNames: boolean;

  update<K extends keyof Config>(
    key: K,
    value: Config[K],
    target?: ConfigurationTarget
  ): Thenable<void>;
}

let cached: Config | undefined = undefined;

export function update(): Config {
  const cfg = workspace.getConfiguration("imandrax");
  cached = {
    debugMode: cfg.get<boolean>("debugMode")!,
    lsp: {
      binary: cfg.get<string>("lsp.binary")!,
      arguments: cfg.get<string[]>("lsp.arguments")!,
      environment: cfg.get<object>("lsp.environment")!,
    },
    terminal: {
      binary: cfg.get<string>("terminal.binary")!,
      arguments: cfg.get<string[]>("terminal.arguments")!,
      freshModelModules: cfg.get<boolean>("terminal.freshModelModules")!,
    },
    useSimpleBrowser: cfg.get<boolean>("useSimpleBrowser")!,
    IMLFormatter: cfg.get<boolean>("IMLFormatter")!,
    largeDecompConfirmation: cfg.get<number>("largeDecompConfirmation")!,
    largeDecompConfirmationBytes: cfg.get<number>("largeDecompConfirmationBytes")!,
    showProvenGoals: cfg.get<boolean>("showProvenGoals")!,
    maximumGoalAge: cfg.get<number>("maximumGoalAge")!,
    hideDefaultNames: cfg.get<boolean>("hideDefaultNames")!,

    update(key, value, target = ConfigurationTarget.Global) {
      return cfg.update(key, value, target);
    },
  };
  return cached;
}

export function getExtensionConfig(): Config {
  if (cached)
    return cached;
  else
    return update();
}