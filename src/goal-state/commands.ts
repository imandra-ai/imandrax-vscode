import { commands, ExtensionContext, window, TabInputCustom } from 'vscode';
import { GoalStateEditorProvider } from './editor_provider';

export function register(context: ExtensionContext) {
  context.subscriptions.push(commands.registerCommand("imandrax.goal-state.noop", () => {
    const input = window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof TabInputCustom && input.viewType == "imandrax.GoalState") {
      return;
    }
  }));

  context.subscriptions.push(commands.registerCommand("imandrax.goal-state.simplify", async () => {
    const input = window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof TabInputCustom && input.viewType == "imandrax.GoalState") {
      // const panel = GoalStateEditorProvider.activePanel;
      await GoalStateEditorProvider.activeDocument?.simplify();
    }
  }));

  context.subscriptions.push(commands.registerCommand("imandrax.goal-state.auto", async () => {
    const input = window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof TabInputCustom && input.viewType == "imandrax.GoalState") {
      await GoalStateEditorProvider.activeDocument?.auto();
    }
  }));
}