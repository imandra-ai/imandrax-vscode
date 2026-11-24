import { ViewColumn, window } from 'vscode';
import { getExtensionConfig } from '../../config';
import { REVEAL_COMMAND } from './mir_db';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Prints the client's JsValue (bigint, Rational, Uid, Constructed, arrays, maps)
function show(v: unknown): string {
  if (Array.isArray(v)) { return `[${v.map(show).join('; ')}]`; }
  if (v instanceof Map) { return `{ ${[...v].map(([k, x]) => `${k} = ${show(x)}`).join('; ')} }`; }
  if (v && typeof v === 'object' && 'name' in v && 'args' in v) {
    const { name, args } = v as { name: string; args: unknown[] };
    return args.length ? `${name} (${args.map(show).join(', ')})` : name;
  }
  return String(v);
}

// A decomposition's regions as a table: constraints, invariant, sample input and output;
// with `taskId`, a link revealing the task in the MIR DB view
export function showRegions(name: string, regions: readonly {
  constraintsStr: readonly string[] | undefined; invariantStr: string | undefined;
  sample(): ReadonlyMap<{ shortName: string }, unknown> | undefined; sampleOutput(): unknown;
}[], taskId?: string) {
  const max = getExtensionConfig().largeDecompConfirmation;
  const rows = regions.slice(0, max).map((r, i) => {
    const sample = r.sample();
    const input = sample ? [...sample].map(([uid, v]) => `${uid.shortName} = ${show(v)}`).join(', ') : '';
    const output = r.sampleOutput();
    return `<tr><td>${i + 1}</td><td>${esc(r.constraintsStr?.join(' && ') ?? '')}</td>`
      + `<td>${esc(r.invariantStr ?? '')}</td><td>${esc(input)}</td>`
      + `<td>${esc(output === undefined ? '' : show(output))}</td></tr>`;
  }).join('');
  const note = regions.length > max
    ? `<p>Showing the first ${max} of ${regions.length} regions (setting <code>imandrax.largeDecompConfirmation</code>).</p>`
    : `<p>${regions.length} regions.</p>`;
  const browse = taskId
    ? `<p><a href="${esc(`command:${REVEAL_COMMAND}?${encodeURIComponent(JSON.stringify([taskId]))}`)}">Browse MIR DB</a></p>` : '';

  const panel = window.createWebviewPanel('imandrax-api-decomp', `Regions of ${name}`, ViewColumn.Beside,
    { enableCommandUris: [REVEAL_COMMAND] });
  panel.webview.html = `<!DOCTYPE html><html><head><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left;
             vertical-align: top; font-family: var(--vscode-editor-font-family); }
    th { background: var(--vscode-editorWidget-background); }
  </style></head><body>
  <h2>Regions of <code>${esc(name)}</code></h2>${note}${browse}
  <table><tr><th>#</th><th>Constraints</th><th>Invariant</th><th>Sample input</th><th>Sample output</th></tr>
  ${rows}</table></body></html>`;
}
