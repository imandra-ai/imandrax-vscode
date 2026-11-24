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
  stripModuleScope: boolean;

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
    stripModuleScope: cfg.get<boolean>("stripModuleScope")!,

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

// Where proof/decomposition tasks run: the language server, or (experimental) the ImandraX HTTP API.
// Read at call time by every feature that runs tasks.
export function taskBackend(): "lsp" | "api" {
  return workspace.getConfiguration("imandrax").get("experimental.taskBackend") === "lsp" ? "lsp" : "api"; // default: api
}

// Whether a file's tasks are checked when it is opened / saved: `--check-on-open` / `--check-on-save`
// (`=BOOL` or ` BOOL`) in imandrax.lsp.arguments, else imandrax-cli's default, which is off for both.
// In "api" mode the extension does these checks itself.
export function checkOn(event: "open" | "save"): boolean {
  const args = workspace.getConfiguration("imandrax").get<string[]>("lsp.arguments") ?? [];
  const i = args.findIndex(a => new RegExp(`^--check-on-${event}(=|$)`).test(a));
  return i >= 0 && (args[i].split("=")[1] ?? args[i + 1]) === "true";
}