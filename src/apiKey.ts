import { Uri, workspace } from 'vscode';
import { homedir } from 'os';

// copied from
// https://github.com/imandra-ai/code-logician-vscode/blob/008f9ddcef0b9dd900bf742109007cc8cd9ff614/src/infrastructure/langgraph.ts#L37

const readOptionalFile = async (file: Uri) => {
  try {
    const res = await workspace.fs.readFile(file);
    return Buffer.from(res.buffer).toString();
  } catch (e) {
    return null;
  }
};

export async function get(): Promise<string | null> {
  const userHome = Uri.file(homedir());
  return (process.env.IMANDRA_API_KEY ||
    (await readOptionalFile(
      Uri.joinPath(userHome, ".config", "imandrax", "api_key")
    )))?.trim();
}