import * as implementations from './implementations';

import { commands, ExtensionContext, languages, Uri, ViewColumn, window, workspace } from 'vscode';
import { LanguageClientWrapper } from '../language_client_wrapper';

export function register(context: ExtensionContext, languageClientWrapper: LanguageClientWrapper) {
  const getClient = () => { return languageClientWrapper.getClient(); };

  const restart_cmd = "imandrax.restart_language_server";
  const restart_handler = () => { languageClientWrapper.restart({ extensionUri: context.extensionUri }); };
  context.subscriptions.push(commands.registerCommand(restart_cmd, restart_handler));

  const check_all_cmd = "imandrax.check_all";
  const check_all_handler = () => { implementations.checkAll(getClient); };
  context.subscriptions.push(commands.registerCommand(check_all_cmd, check_all_handler));

  const browse_cmd = "imandrax.browse";
  const browse_handler = (uri: string) => { implementations.browse(uri); };
  context.subscriptions.push(commands.registerCommand(browse_cmd, browse_handler));

  const toggle_full_ids_cmd = "imandrax.toggle_full_ids";
  const toggle_full_ids_handler = () => { implementations.toggle_full_ids(getClient); };
  context.subscriptions.push(commands.registerCommand(toggle_full_ids_cmd, toggle_full_ids_handler));

  const create_terminal_cmd = "imandrax.create_terminal";
  const create_terminal_handler = () => { implementations.create_terminal(undefined); };
  context.subscriptions.push(commands.registerCommand(create_terminal_cmd, create_terminal_handler));

  const terminal_eval_selection_cmd = "imandrax.terminal_eval_selection";
  const terminal_eval_selection_handler = () => { implementations.terminal_eval_selection(); };
  context.subscriptions.push(commands.registerCommand(terminal_eval_selection_cmd, terminal_eval_selection_handler));

  const clear_cache_cmd = "imandrax.clear_cache";
  const clear_cache_handler = () => { implementations.clear_cache(getClient); };
  context.subscriptions.push(commands.registerCommand(clear_cache_cmd, clear_cache_handler));

  const open_vfs_file_cmd = "imandrax.open_vfs_file";
  const open_vfs_file_handler = async () => {
    const what = await window.showInputBox({ placeHolder: 'file uri?' });
    if (what) {
      const uri = Uri.parse(what);
      const doc = await workspace.openTextDocument(uri);
      await window.showTextDocument(doc, { preview: false });
    }
  };

  context.subscriptions.push(commands.registerCommand(open_vfs_file_cmd, open_vfs_file_handler));

  context.subscriptions.push(workspace.registerTextDocumentContentProvider("imandrax-vfs", languageClientWrapper.getVfsProvider()));

  const open_goal_state_cmd = "imandrax.open_goal_state";
  const open_goal_state_handler = async () => {
    const uri = Uri.parse("imandrax-vfs://internal//goal-state.md");
    const doc = await workspace.openTextDocument(uri);
    await window.showTextDocument(doc, { preview: false, viewColumn: ViewColumn.Beside, preserveFocus: true });
    languages.setTextDocumentLanguage(doc, "markdown");
  };
  context.subscriptions.push(commands.registerCommand(open_goal_state_cmd, open_goal_state_handler));

  const reset_goal_state_cmd = "imandrax.reset_goal_state";
  const reset_goal_state_handler = () => {
    if (getClient() && getClient().isRunning()) {
      try {
        getClient().sendRequest("workspace/executeCommand", { "command": "reset-goal-state", "arguments": [] });
      }
      catch (e) {
        console.log("caught something!");
        console.log(e);
      }
    }
    return true;
  };
  context.subscriptions.push(commands.registerCommand(reset_goal_state_cmd, reset_goal_state_handler));

}