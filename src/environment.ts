import Which = require('which');
import {
  workspace,
  WorkspaceConfiguration
} from "vscode";

let env: {
  config: WorkspaceConfiguration,
  binary,
  server_args,
  server_env,
  system_env: NodeJS.ProcessEnv,
  merged_env,
  bin_abs_path: string
};

export function get_env() {
  const config = workspace.getConfiguration("imandrax");
  const binary = config.lsp.binary;
  const server_args = config.lsp.arguments;
  const server_env = config.lsp.environment;

  const system_env = process.env;
  const merged_env = Object.assign(system_env, server_env);

  const bin_abs_path = Which.sync(binary, { nothrow: true });

  return { config, binary, server_args, server_env, system_env, merged_env, bin_abs_path };
}