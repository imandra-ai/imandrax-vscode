import { commands, Uri, ViewColumn, Webview, window } from 'vscode';
import { getExtensionConfig } from '../config';

export const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// A decomposition as the language server sends it (`$imandrax/visualize-decomp`)
export interface Decomp {
  source: string; // Function name
  decomp: string; // HTML-encoded regions for voronoi
  num_regions: number; // Number of regions
}

// The Voronoi viewer of decompositions (assets/voronoi.js, imandrax-hydrate.js): the language server's
// `$imandrax/visualize-decomp` requests and the API backend's decompositions. Asks first when they are large
// (settings `imandrax.largeDecompConfirmationBytes`, `imandrax.largeDecompConfirmation`).
export class DecompositionView {
  constructor(private readonly extensionUri: Uri) { }

  async show(decomps: readonly Decomp[]) {
    const config = getExtensionConfig();
    const total_regions = decomps.reduce((n, d) => n + ('num_regions' in d ? d.num_regions : 0), 0);
    const total_bytes = decomps.reduce((n, d) => n + d.decomp.length, 0);
    if (total_bytes > config.largeDecompConfirmationBytes
      && !await ask(`very large (${num_bytes_to_string(total_bytes)})`, 'imandrax.largeDecompConfirmationBytes')) { return; }
    if (total_regions > config.largeDecompConfirmation
      && !await ask(`very large (${total_regions} regions)`, 'imandrax.largeDecompConfirmation')) { return; }
    const sources = decomps.map(d => d.source);
    const body = decomps.map(d => `<h1>Decomposition of <span class="code">${esc(d.source)}</span></h1>${d.decomp}`).join('');
    const panel = window.createWebviewPanel('imandrax-decomp', `Decomposition of ${sources.join(', ')}`, ViewColumn.One, {
      enableScripts: true, localResourceRoots: [Uri.joinPath(this.extensionUri, 'assets')], enableCommandUris: true,
    });
    panel.webview.html = this.html(panel.webview, body);
  }

  private html(pwv: Webview, body: string) {
    const assets_path = Uri.joinPath(this.extensionUri, 'assets');
    const asset = (name: string) => pwv.asWebviewUri(Uri.joinPath(assets_path, name)).toString();
    const voronoi_uri = asset('voronoi.js');
    const imandrax_hydrate_uri = asset('imandrax-hydrate.js');
    const style1_uri = asset('decomp-style.css');
    const style2_uri = asset('styles.b466ce6f.css');
    const style3_uri = asset('style.min.98373da4.css');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="${style2_uri}">
  <link rel="stylesheet" href="${style3_uri}">
  <link rel="stylesheet" href="${style1_uri}">
	<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/2.2.4/jquery.min.js"></script>
	<script src="${voronoi_uri}"></script>
	<script src="${imandrax_hydrate_uri}"></script>
</head>
<body style="background-color: transparent;">
${body}
</body>
</html>`;
  }
}

// Asks before showing a large decomposition: true = show it
async function ask(why: string, setting: string) {
  const q = await window.showWarningMessage(
    `This decomposition is not displayed in the editor because it is ${why}.`,
    {},
    { title: 'Open Anyway' },
    { title: 'Cancel', isCloseAffordance: true },
    { title: 'Configure Limit' });
  if (q?.title === 'Configure Limit') { void commands.executeCommand('workbench.action.openSettings', setting); }
  return q?.title === 'Open Anyway';
}

function num_bytes_to_string(num: number): string {
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  let n = num;
  let i = 0;
  for (; i < units.length; i++) {
    if (n > 1024) { n /= 1024; } else { break; }
  }
  return `${n.toFixed(0)} ${units[i]}`;
}
