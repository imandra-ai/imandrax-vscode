import * as ApiKey from './api_key';

import * as Path from 'path';
import * as Which from "which";

import { commands, ConfigurationTarget, env, MessageItem, ProgressLocation, QuickPickItem, QuickPickOptions, Uri, window, workspace } from "vscode";
import { exec } from 'child_process';

import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';
import { stat } from 'fs/promises';


async function getApiKeyInput() {
  const result = await window.showInputBox({
    placeHolder: 'Paste your API key here',
    ignoreFocusOut: true
  });

  if (!result?.trim()) {
    return;
  }

  await ApiKey.put(result.trim());
  window.showInformationMessage('API key saved');
}

async function promptForApiKey() {
  const options: QuickPickOptions = { title: 'Choose how to configure your API key', ignoreFocusOut: true };

  const existingApiKey: string | undefined = await ApiKey.get();

  // items
  const useExisting = { label: "Use already configured API key" };
  const goToIu = { label: 'Go to Imandra Universe and obtain/copy an API key' };
  const pasteNow = { label: "I've already copied my API key, let me paste it in" };
  const skip = { label: "Skip configuring API key for now" };

  // only show useExisting if one actually exists
  const makeItems = (others: QuickPickItem[]) => (existingApiKey ? [useExisting] : []).concat(others);

  const items: readonly QuickPickItem[] = makeItems([goToIu, pasteNow, skip]);

  const itemT = await window.showQuickPick(items, options);

  switch (itemT?.label) {
    case goToIu.label:
      env.openExternal(await env.asExternalUri(Uri.parse("https://universe.imandra.ai/user/api-keys")));
      await getApiKeyInput();
      break;
    case pasteNow.label:
      await getApiKeyInput();
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
  const itemT: MessageItem | undefined = await window.showInformationMessage("ImandraX installed!\nReload window to proceed", ...items);

  if (itemT?.title === reloadWindowItem.title) {
    commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function setBinaryPaths(openUri: Uri) {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    window.showErrorMessage(
      `Could not determine your home directory. ` +
      `Set 'lsp.binary' and 'terminal.binary' to the full path` +
      `where imandrax-cli has been installed:\n` +
      `[Workspace Settings](${openUri.toString()})`
    );
    return;
  }

  const config = workspace.getConfiguration('imandrax');
  const binaryPath = Path.join(homeDir, '.local', 'bin', 'imandrax-cli');

  await config.update('lsp.binary', binaryPath, ConfigurationTarget.Global);
  await config.update('terminal.binary', binaryPath, ConfigurationTarget.Global);
}

async function handleSuccess(openUri: Uri) {
  await setBinaryPaths(openUri);
  await promptForApiKey();
  await promptToReloadWindow();
}

async function runInstallerForUnix(itemT: MessageItem, title: string): Promise<void> {
  if (itemT.title === title) {
    return new Promise<void>((resolve, reject) => {
      const url = "https://imandra.ai/get-imandrax.sh";

      const getCmdPrefix = () => {
        const wgetPath = Which.sync("wget", { nothrow: true });
        if (wgetPath !== "" && wgetPath !== null) {
          return "wget -qO-";
        }
        else {
          const curlPath = Which.sync("curl", { nothrow: true });
          if (curlPath !== "" && curlPath !== null) {
            return "curl -fsSL";
          }
          else {
            reject(new Error(`Neither curl nor wget available for downloading the ImandraX installer.`));
          }
        }
      };

      const out = window.createOutputChannel('ImandraX installer', { log: true });

      const child = exec(`(set -e
        ${getCmdPrefix()} ${url} | sh -s -- -y);
        EC=$? && sleep .5 && exit $EC`);

      /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      child.stdout?.on('data', chunk => out.append(chunk.toString()));
      child.stderr?.on('data', chunk => out.append(chunk.toString()));
      /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

      child.on('close', code =>
      (out.appendLine(`\n[installer exited with code ${code}]`),
        (code === 0 ? (resolve()) : (reject(new Error(`Failed with code: ${code}`))))));
    });
  }
}

export async function promptToInstall(openUri: Uri, update?: boolean) {
  const launchInstallerItem = { title: "Launch installer" } as const;
  const items: readonly MessageItem[] = [launchInstallerItem];
  let itemT: MessageItem | undefined;
  if (update) {
    itemT = await window.showErrorMessage(`An updated imandrax-cli binary is available.`, ...items);
  } else {
    itemT = await window.showErrorMessage(`Could not find ImandraX. Please install it or ensure the imandrax-cli binary is in your PATH or its location is set in [Workspace Settings](${openUri.toString()}).`, ...items);
  }
  if (itemT) {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Installing ImandraX"
      },
      () => runInstallerForUnix(itemT, launchInstallerItem.title)).then(
        () => handleSuccess(openUri),
        async (reason) => { await window.showErrorMessage(`ImandraX install failed\n ${reason}`); }
      );
  }
}

export async function checkVersion() {
  interface BucketContent {
    Key: string;
    Generation: string;
  }
  
  interface ListBucketResult {
    Contents: BucketContent[];
  }
  
  interface ParsedXmlResponse {
    ListBucketResult: ListBucketResult;
  }

  async function fetchAndParseXml(url: string): Promise<ParsedXmlResponse | undefined> {
    let xmlText: string | undefined;
    try {
      const response = await fetch(url);
      xmlText = await response.text();
    } catch (error) {
      console.error('Error fetching XML:', error);
      return undefined;
    }

    try {
      return await parseStringPromise(xmlText, { explicitArray: false }) as ParsedXmlResponse;
    } catch (error) {
      console.error('Error parsing XML:', error);
    }
  }


  async function getFileModificationDate(filePath: string): Promise<Date | null> {
    try {
      const stats = await stat(filePath);
      return stats.mtime;
    } catch (e) {
      console.error(`Error reading file stats: ${e as string}`);
      return null;
    }
  }
  
  const data = await fetchAndParseXml("https://storage.googleapis.com/imandra-prod-imandrax-releases");
  const item = data?.ListBucketResult.Contents.find(item => item.Key === "imandrax-macos-aarch64-latest.pkg");

  const homeDir = process.env.HOME;
  if (!homeDir) {
    window.showErrorMessage(
      `Could not determine your home directory. ` // +
      // `Set 'lsp.binary' and 'terminal.binary' to the full path` +
      // `where imandrax-cli has been installed:\n` +
      // `[Workspace Settings](${openUri.toString()})`
    );
    return false;
  }

  const binaryPath = Path.join(homeDir, '.local', 'bin', 'imandrax-cli');

  const remoteGeneration = Math.floor(Number(item?.Generation) / 1000)
  const localGeneration = Number((await getFileModificationDate(binaryPath))?.getTime() ?? 0);

  return remoteGeneration > localGeneration;
}