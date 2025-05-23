import * as ApiKey from './apiKey';
import * as Which from "which";
import { commands, env, MessageItem, ProgressLocation, QuickPickItem, QuickPickOptions, Uri, window, workspace } from "vscode";
import { exec, ExecOptions } from 'child_process';

async function getApiKeyInput() {
  const result = await window.showInputBox({
    placeHolder: 'Paste your API key here',
    ignoreFocusOut: true
  });

  if (!result?.trim()) {
    return;
  }

  await ApiKey.put(result.trim());
  window.showInformationMessage('API key saved to disk.');
}

async function promptForApiKey() {
  const options: QuickPickOptions = { title: 'Choose how to configure your API key', ignoreFocusOut: true };

  const existingApiKey: string | null = await ApiKey.get();

  // items
  const useExisting = { label: "Use already configured API key" };
  const goToIu = { label: 'Go to Imandra Universe and obtain/copy an API key' };
  const pasteNow = { label: "I've already copied my API key, let me paste it in" };
  const skip = { label: "Skip configuring API key for now" };

  // only show useExisting if one actually exists
  const makeItems = (others: QuickPickItem[]) => (existingApiKey ? [useExisting] : []).concat(others);

  const items: readonly QuickPickItem[] = makeItems([goToIu, pasteNow, skip]);

  const itemT = await window.showQuickPick(items, options);

  switch (itemT.label) {
    case goToIu.label:
      env.openExternal(await env.asExternalUri(Uri.parse("https://universe.imandra.ai/user/api-keys")));
      getApiKeyInput();
      break;
    case pasteNow.label:
      getApiKeyInput();
      break;
    case skip.label:
      break;
    case useExisting.label:
      break;
  }
}

async function promptToReloadWindow() {
  const reloadWindowItem = { title: "Reload window" } as const;
  const items: readonly MessageItem[] = [reloadWindowItem];
  const itemT = await window.showInformationMessage("ImandraX installed!\nReload window to proceed", ...items);

  if (itemT.title === reloadWindowItem.title) {
    commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function handleSuccess() {
  await promptForApiKey();
  await promptToReloadWindow();
}

async function runInstallerForUnix(itemT: MessageItem, title: string): Promise<void> {
  if (itemT.title === title) {
    return new Promise<void>((resolve, reject) => {
      const url = "https://imandra.ai/get-imandrax.sh";

      const getCmdPrefix = () => {
        const wgetPath = Which.sync("wget", { nothrow: true });
        if (wgetPath != "" && wgetPath != null) {
          return "wget -qO-";
        }
        else {
          const curlPath = Which.sync("curl", { nothrow: true });
          if (curlPath != "" && curlPath != null) {
            return "curl -fsSL";
          }
          else {
            reject(`Neither curl nor wget available for downloading the ImandraX installer.`);
          }
        }
      };

      const out = window.createOutputChannel('ImandraX installer', { log: true });

      const child = exec(`(set -e      
        ${getCmdPrefix()} ${url} | sh -s -- -y); 
        EC=$? && sleep .5 && exit $EC`);

      child.stdout?.on('data', chunk => out.append(chunk.toString()));
      child.stderr?.on('data', chunk => out.append(chunk.toString()));
      child.on('close', code =>
      (out.appendLine(`\n[installer exited with code ${code}]`),
        (code === 0 ? (resolve()) : (reject(`Failed with code: ${code}`)))));
    });
  }
}

export async function promptToInstall(openUri: Uri) {
  const launchInstallerItem = { title: "Launch installer" } as const;
  const items: readonly MessageItem[] = [launchInstallerItem];

  const itemT = await window.showErrorMessage(`Could not find ImandraX. Please install it or ensure the imandrax-cli binary is in your PATH or its location is set in [Workspace Settings](${openUri}).`, ...items);

  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Installing ImandraX"
    },
    () => runInstallerForUnix(itemT, launchInstallerItem.title)).then(
      handleSuccess,
      async (reason) => { await window.showErrorMessage(`ImandraX install failed\n ${reason}`); }
    );
}
