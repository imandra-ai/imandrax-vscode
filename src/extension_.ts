import * as commands_ from './commands';
import * as lsp_client from './lsp_client';

import { Uri, workspace } from 'vscode';


export function update_configuration(extensionUri: Uri, event): Promise<void> {
  if (event == undefined || event.affectsConfiguration('imandrax')) {
    const client = lsp_client.client;
    if (event && (
      event.affectsConfiguration('imandrax.lsp.binary') ||
      event.affectsConfiguration('imandrax.lsp.arguments') ||
      event.affectsConfiguration('imandrax.lsp.environment')))
      lsp_client.restart({ initial: client == undefined, extensionUri: extensionUri });

    if (client && client.isRunning()) {
      const config = workspace.getConfiguration("imandrax");
      return client.sendNotification("workspace/didChangeConfiguration", {
        "settings":
        {
          "show-full-ids": commands_.showFullIDs,
          "goal-state-show-proven": config.lsp.showProvenGoals
        }
      });
    }
  }
}
