import { MessageItem, window } from "vscode";

export async function runInstallerForLinux(itemT: MessageItem, title: string): Promise<void> {
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
          ? (resolve(), await window.showInformationMessage("ImandraX installed"))
          : (reject(), await window.showErrorMessage(`ImandraX install failed with ${code}`));
        sub.dispose();
      });

      term.show();
    });
  }
}
