import type { Decomp } from '../decomposition_view';
import { REVEAL_COMMAND } from './mir_db/view';

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

// A decomposition for the Voronoi viewer (DecompositionView): the markup and region data
// assets/imandrax-hydrate.js expects, as the language server renders it. Below it, the regions as a table
// (constraints, invariant, sample input and output); with `taskId`, a link revealing the task in the MIR DB view.
// ponytail: flat, numbered regions; the server also nests them in groups sharing a constraint
export function regionsDecomp(name: string, regions: readonly {
  constraintsStr: readonly string[] | undefined; invariantStr: string | undefined;
  sample(): ReadonlyMap<{ shortName: string }, unknown> | undefined; sampleOutput(): unknown;
}[], taskId?: string): Decomp {
  // hydrate inserts constraints and invariants as HTML
  const groups = regions.map((r, i) => ({
    label: `${i + 1}`, weight: 1, groups: [],
    constraints: (r.constraintsStr ?? []).map(esc), region: { invariant: esc(r.invariantStr ?? '') },
  }));
  const rows = regions.map((r, i) => {
    const sample = r.sample();
    const input = sample ? [...sample].map(([uid, v]) => `${uid.shortName} = ${show(v)}`).join(', ') : '';
    const output = r.sampleOutput();
    return `<tr><td>${i + 1}</td><td>${esc(r.constraintsStr?.join(' && ') ?? '')}</td>`
      + `<td>${esc(r.invariantStr ?? '')}</td><td>${esc(input)}</td>`
      + `<td>${esc(output === undefined ? '' : show(output))}</td></tr>`;
  }).join('');
  const browse = taskId
    ? `<p><a href="${esc(`command:${REVEAL_COMMAND}?${encodeURIComponent(JSON.stringify([taskId]))}`)}">Browse MIR DB</a></p>` : '';
  const help = ['Concrete regions are numbered', 'Click on a region to view its details', 'Double click on a region to zoom in on it',
    'Shift+double click to zoom out', 'Hit escape to reset back to the top'];

  const decomp = `${browse}<div class="decompose">
  <textarea class="display-none">${esc(JSON.stringify({ regions: groups }))}</textarea>
  <div class="decompose-foamtree"></div>
  <div class="decompose-details">
    <div class="decompose-details-header">Region details</div>
    <div class="decompose-details-no-selection"><ul>${help.map(h => `<li>${h}</li>`).join('')}</ul></div>
    <div class="decompose-details-selection hidden">
      <div class="decompose-details-label">Direct sub-regions: <span class="decompose-details-direct-sub-regions-text"></span></div>
      <div class="decompose-details-label">Contained regions: <span class="decompose-details-contained-regions-text"></span></div>
      <div class="decompose-details-section-header">Constraints</div>
      <div class="decompose-details-constraints"></div>
      <div class="decompose-details-invariant">
        <div class="decompose-details-section-header">Invariant</div>
        <div class="decompose-details-invariant-text"></div>
      </div>
    </div>
  </div>
</div>
<script>hydrate('.decompose')</script>
<style>
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left;
           vertical-align: top; font-family: var(--vscode-editor-font-family); }
  th { background: var(--vscode-editorWidget-background); }
</style>
<details><summary>${regions.length} regions as a table</summary>
<table><tr><th>#</th><th>Constraints</th><th>Invariant</th><th>Sample input</th><th>Sample output</th></tr>
${rows}</table></details>`;
  return { source: esc(name), decomp, num_regions: regions.length };
}
