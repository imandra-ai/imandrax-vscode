import { commands, ExtensionContext, window, TabInputCustom } from 'vscode';
import { GoalStateEditorProvider } from './editor_provider';

export function register(context: ExtensionContext) {
  context.subscriptions.push(commands.registerCommand("imandrax.goal-state.simplify", async () => {
    const input = window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof TabInputCustom && input.viewType == "imandrax.GoalState") {
      // const panel = GoalStateEditorProvider.activePanel;
      const document = GoalStateEditorProvider.activeDocument;
      await document?.simplify();
    }
  }));
}