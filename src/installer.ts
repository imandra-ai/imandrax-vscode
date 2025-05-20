import { commands, MessageItem, ProgressLocation, Uri, window } from "vscode";

async function handleSuccess() {
  const reloadWindowItem = { title: "Reload window" } as const;
  const items: readonly MessageItem[] = [reloadWindowItem];
  const itemT = await window.showInformationMessage("ImandraX installed!\nReload window to proceed", ...items);

  if (itemT.title === reloadWindowItem.title) {
    commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function runInstallerForUnix(itemT: MessageItem, title: string): Promise<void> {
  if (itemT.title === title) {
    return new Promise<void>((resolve, reject) => {
      const term = window.createTerminal({
        name: "Install ImandraX",
        hideFromUser: false,
      });

      const url = "https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/s/support-linux/scripts/install.sh";

      term.sendText(`yes '' | sh -c "$(curl -fsSL ${url})"; exit`);

      const sub = window.onDidCloseTerminal(async t => {
        const code = t.exitStatus?.code ?? -1;
        code === 0
          ? (resolve())
          : (reject(code));
        sub.dispose();
      });

      term.show();
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
      handleSuccess, async (code) => { await window.showErrorMessage(`ImandraX install failed with ${code}`); }
    );
}
