import { Uri, workspace } from 'vscode';
import { homedir } from 'os';

const CONFIG_DIR = ['.config', 'imandrax'] as const;
const API_KEY_FILE = 'api_key';

const readOptionalFile = async (file: Uri) => {
  try {
    const res = await workspace.fs.readFile(file);
    return Buffer.from(res.buffer).toString();
  } catch {
    return null;
  }
};

function getApiKeyFileUri(): Uri {
  const home = Uri.file(homedir());
  const configDir = Uri.joinPath(home, ...CONFIG_DIR);
  return Uri.joinPath(configDir, API_KEY_FILE);
}

export async function get(): Promise<string | undefined> {
  return (process.env.IMANDRA_API_KEY ??
    (await readOptionalFile(
      getApiKeyFileUri()
    )))?.trim();
}

export async function put(key: string): Promise<void> {
  const file = getApiKeyFileUri();
  await workspace.fs.createDirectory(file.with({ path: file.path.replace(/\/[^/]+$/, '') })); // parent dir
  await workspace.fs.writeFile(file, Buffer.from(key, 'utf8')); // overwrite OK
}
