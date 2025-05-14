
// looks like getting this to work on wsl will be a chore
// docs here: https://code.visualstudio.com/docs/remote/wsl
// i guess that means we'll need to require the wsl extension for imandrax

import { kMaxLength } from 'buffer';
import * as cp from 'child_process';
import { env, MessageItem, window } from 'vscode';

// are we on windows?
const onWindows = process.platform === 'win32';

// is the extension host running in wsl?
const inRemoteWsl = env.remoteName === 'wsl';

// does windows have wsl?

const hasWsl = (() => {
  if (!onWindows) { return false; }
  try {
    cp.execSync('wsl.exe --list --quiet', { stdio: 'ignore' });
    return true;
  }
  catch { return false; }
})();

// apparently there can also be a Node process running in wsl... not sure about that



export async function maybeRunInstaller(itemT: MessageItem, title: string): Promise<void> {
  if ((!onWindows) || (onWindows && hasWsl)) {
    if (itemT.title === title) {
      return new Promise<void>((resolve, reject) => {
        const term = window.createTerminal({
          name: 'Install ImandraX',
          hideFromUser: false,

        });

        const url = 'https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/s/support-linux/scripts/install.sh';

        if (onWindows) {
          term.sendText(`wsl sh -c "yes '' | sh -c \`$(curl -fsSL ${url})";`);
        }
        else {
          term.sendText(`yes '' | sh -c "$(curl -fsSL ${url})"; exit`);
        }

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
  } else {
    return Promise.reject("Windows users need to have WSL installed to use ImandraX.");
  }
}
