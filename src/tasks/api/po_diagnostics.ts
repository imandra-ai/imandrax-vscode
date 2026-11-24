import {
  CodeAction, CodeActionContext, CodeActionKind, Diagnostic, DiagnosticSeverity, Disposable, languages, Range, TextDocument, Uri,
} from 'vscode';
import type { ProofObligationResult } from 'imandrax-api';
import type { TaskTarget } from '../backend';
import { MirDbView, REVEAL_COMMAND } from './mir_db/view';

// Proof obligation results as diagnostics shaped like the server's (Hint = proved/instance, which get the
// good gutter icon), each with a "Browse MIR DB" quick fix while its task is in the MIR DB view
export class PoDiagnostics implements Disposable {
  private readonly collection = languages.createDiagnosticCollection('ImandraX API');
  // The diagnostics set, by URI: code actions get copies of them (without `taskId`), matched back here
  private readonly shown = new Map<string, readonly PoDiagnostic[]>();
  private readonly browse = languages.registerCodeActionsProvider({ language: 'imandrax' },
    { provideCodeActions: (doc, _range, context) => this.codeActions(doc, context) });

  constructor(private readonly mirDb: MirDbView) { }

  // Replaces the file's diagnostics, or with a target only those of the POs that ran
  show(doc: TextDocument, results: readonly ProofObligationResult[], target?: TaskTarget) {
    const ran = new Set(results.map(r => r.origin.fromSym));
    const kept = target ? (this.shown.get(doc.uri.toString()) ?? []).filter(d => !ran.has(d.code as string)) : [];
    const all = [...kept, ...results.map(r => {
      const [severity, message] = verdict(r);
      const d = new PoDiagnostic(placeOf(doc, r, target), message, severity, r.task.id.toString());
      d.source = 'ImandraX'; // decorated in the gutter like the server's
      d.code = r.origin.fromSym; // which PO, for the partial replace above
      return d;
    })];
    this.shown.set(doc.uri.toString(), all);
    this.collection.set(doc.uri, all);
  }

  // The results shown: successful = proved/instance found (Hint), failed = refuted or error
  counts(uri: Uri) {
    const ds = this.collection.get(uri) ?? [];
    const successful = ds.filter(d => d.severity === DiagnosticSeverity.Hint).length;
    const failed = ds.filter(d => d.severity === DiagnosticSeverity.Error).length;
    return { total: ds.length, successful, failed };
  }

  dispose() {
    this.collection.dispose();
    this.browse.dispose();
  }

  private codeActions(doc: TextDocument, context: CodeActionContext) {
    const shown = this.shown.get(doc.uri.toString()) ?? [];
    return context.diagnostics.flatMap(d => {
      const po = shown.find(p => p.range.isEqual(d.range) && p.message === d.message && p.source === d.source && p.code === d.code);
      if (!po || !this.mirDb.has(po.taskId)) { return []; }
      const title = `Browse MIR DB (${po.code as string})`;
      const action = new CodeAction(title, CodeActionKind.QuickFix);
      action.command = { title, command: REVEAL_COMMAND, arguments: [po.taskId] };
      action.diagnostics = [d];
      return [action];
    });
  }
}

// A PO result, with its task for the "Browse MIR DB" code action
class PoDiagnostic extends Diagnostic {
  constructor(range: Range, message: string, severity: DiagnosticSeverity, readonly taskId: string) {
    super(range, message, severity);
  }
}

const otherLabels: Record<string, string> = { unknown: 'Unknown', err: 'Error', verifiedUpto: 'Verified up to bound', testOk: 'Test passed' };

// Like the server: proved and instances are Hints, counterexamples Errors, anything else a Warning
function verdict(r: ProofObligationResult): [DiagnosticSeverity, string] {
  if (r.proved) { return [DiagnosticSeverity.Hint, 'Proved']; }
  // A found model is a counterexample to a `verify`/theorem (reported with an error) or an instance
  if (r.found && (r.model ? r.model.kind === 'counterExample' : r.errors.length > 0)) {
    return [DiagnosticSeverity.Error, `Refuted, counterexample:\n${r.model?.src.trim() ?? '(not sent)'}`];
  }
  if (r.found) { return [DiagnosticSeverity.Hint, `Instance found:\n${r.model?.src.trim() ?? '(not sent)'}`]; }
  const label = otherLabels[r.outcome ?? ''] ?? 'No result';
  const why = r.message ?? r.errors.map(String).join('\n');
  return [DiagnosticSeverity.Warning, why ? `${label}: ${why}` : label];
}

// The PO's error location if it has one (refuted, unknown, ...), else the clicked lens if it is this PO's,
// else the line defining its symbol: anonymous `verify`/`instance` symbols are `_verify_<line>_<col>`
function placeOf(doc: TextDocument, r: ProofObligationResult, target?: TaskTarget): Range {
  const loc = r.errors.flatMap(e => e.message.locations)[0];
  if (loc) { return new Range(loc.start.line - 1, loc.start.column - 1, loc.stop.line - 1, loc.stop.column); }
  const from = r.origin.fromSym;
  if (target?.lens && target.sym === from) { return target.lens.range; }
  const anon = /^_(?:verify|instance)_(\d+)_\d+$/.exec(from);
  // ponytail: first textual definition of the name; a local `let` of the same name earlier would win
  const name = from.split('.').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = doc.getText().search(new RegExp(`\\b(?:let|rec|and|theorem|lemma|axiom|rule)\\s+${name}(?![\\w'])`));
  const line = anon ? +anon[1] - 1 : doc.positionAt(Math.max(at, 0)).line;
  return doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
}
