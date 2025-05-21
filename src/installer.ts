import * as ApiKey from './apiKey';
import { commands, env, MessageItem, ProgressLocation, QuickPickItem, QuickPickOptions, Uri, window, workspace } from "vscode";

async function getApiKeyInput(apiKey: string | null) {
  const result = await window.showInputBox({
    title: 'Enter your API key',
    prompt: 'from universe.imandra.ai/user/api-keys',
    ignoreFocusOut: true,
    ...(apiKey
      ? { value: apiKey }
      : { placeHolder: 'foo' })
  });
  window.showInformationMessage(`Got: ${result}`);
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
      getApiKeyInput(existingApiKey);
      break;
    case pasteNow.label:
      getApiKeyInput(existingApiKey);
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
      const term = window.createTerminal({
        name: "Install ImandraX",
        hideFromUser: true,
      });

      const url = "https://imandra.ai/get-imandrax.sh";

      term.sendText(`yes '' | sh -c "$(curl -fsSL ${url})"; exit`);

      const sub = window.onDidCloseTerminal(async t => {
        const code = t.exitStatus?.code ?? -1;
        code === 0
          ? (resolve())
          : (reject(code));
        sub.dispose();
      });
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
      async (code) => { await window.showErrorMessage(`ImandraX install failed with ${code}`); }
    );
}
