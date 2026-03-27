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
  showUnattemptedGoals: boolean;

  update<K extends keyof Config>(
    key: K,
    value: Config[K],
    target?: ConfigurationTarget
  ): Thenable<void>;
}

export function getConfig(): Config {
  const cfg = workspace.getConfiguration("imandrax");
  return {
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
    showUnattemptedGoals: cfg.get<boolean>("showUnattemptedGoals")!,

    update(key, value, target = ConfigurationTarget.Global) {
      return cfg.update(key, value, target);
    },
  };
}