import {
  CancellationToken,
  commands,
  debug,
  DebugAdapterDescriptor,
  DebugAdapterDescriptorFactory,
  DebugAdapterInlineImplementation,
  DebugConfiguration,
  DebugConfigurationProvider,
  DebugSession,
  DebugStackFrame,
  ExtensionContext,
  Range,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  window,
  workspace,
  WorkspaceFolder,
} from 'vscode';

import { getExtensionConfig } from '../../config';
import * as IX from '../imandrax_types';
import { ProofDebugSession, LaunchArguments, StepState } from './session';
import { ProofStepView } from './view';

export const debugType = "imandrax";

const goalStateUri = Uri.parse("imandrax-vfs://internal//goal-state.ixgs");

async function loadGoalState(): Promise<IX.GoalState | undefined> {
  const data = new TextDecoder().decode(await workspace.fs.readFile(goalStateUri));
  return data === "" ? undefined : JSON.parse(data) as IX.GoalState;
}

function sameFile(uri: string, file: string): boolean {
  return Uri.parse(uri).fsPath === Uri.file(file).fsPath;
}

/** Pick the goal to debug: by name, or the one at the cursor, or by asking. */
async function pickGoal(state: IX.GoalState, config: LaunchArguments): Promise<IX.Goal | undefined> {
  const withSteps = state.goals.filter(g => (g.subresults ?? []).some(x => x.length > 0));
  const inFile = config.file ? withSteps.filter(g => g.location && sameFile(g.location.uri, config.file!)) : withSteps;

  let candidates = inFile;
  if (config.goal)
    candidates = inFile.filter(g => g.name === config.goal);
  else {
    const editor = window.activeTextEditor;
    if (editor && config.file && sameFile(editor.document.uri.toString(), config.file)) {
      const line = editor.selection.active.line + 1;
      const atCursor = inFile.filter(g => g.location && Number(g.location.from.line) <= line && line <= Number(g.location.to.line));
      if (atCursor.length > 0)
        candidates = atCursor;
    }
  }
  if (candidates.length == 1)
    return candidates[0];
  if (candidates.length == 0)
    candidates = withSteps;
  if (candidates.length == 0)
    return undefined;

  const picked = await window.showQuickPick(candidates.map(g => ({
    label: g.name,
    description: g.location ? `${workspace.asRelativePath(Uri.parse(g.location.uri))}:${g.location.from.line}` : undefined,
    detail: g.outdated ? "outdated" : undefined,
    goal: g,
  })), { placeHolder: "Select the goal whose proof to debug" });
  return picked?.goal;
}

class ConfigurationProvider implements DebugConfigurationProvider {
  provideDebugConfigurations(_folder: WorkspaceFolder | undefined): DebugConfiguration[] {
    return [{ type: debugType, request: "launch", name: "Debug proof at cursor", file: "${file}", stopOnEntry: true }];
  }

  resolveDebugConfiguration(_folder: WorkspaceFolder | undefined, config: DebugConfiguration): DebugConfiguration {
    // F5 without a launch.json.
    if (!config.type && !config.request && !config.name) {
      config.type = debugType;
      config.request = "launch";
      config.name = "Debug proof at cursor";
    }
    config.file ??= "${file}";
    config.stopOnEntry ??= true;
    config.stripModuleScope ??= getExtensionConfig().stripModuleScope;
    return config;
  }

  async resolveDebugConfigurationWithSubstitutedVariables(_folder: WorkspaceFolder | undefined, config: DebugConfiguration, _token?: CancellationToken): Promise<DebugConfiguration | undefined> {
    if (config.anchor)
      return config;

    let state;
    try {
      state = await loadGoalState();
    } catch (e) {
      void window.showErrorMessage(`Cannot debug proof: the goal state is not available (${e instanceof Error ? e.message : String(e)}).`);
      return undefined;
    }
    const goal = state ? await pickGoal(state, config as LaunchArguments) : undefined;
    if (!goal) {
      void window.showErrorMessage("Cannot debug proof: no goal with tactic steps (subresults) found, please check the goal first.");
      return undefined;
    }
    config.anchor = goal.anchor;
    config.goal = goal.name;
    return config;
  }
}

/**
 * Reveal the tactic of a step in the editor group that shows its file, or in the
 * first group. VS Code reveals the source of the top stack frame itself, but in
 * the active group if the file is not open there, which is often the goal
 * state's or the proof step view's group. Doing it first makes that group
 * active, so VS Code's reveal lands there too.
 */
async function revealStep(state: StepState) {
  const loc = state.location ?? state.goal.byLocation ?? state.goal.location;
  if (!loc)
    return;
  const uri = Uri.parse(loc.uri);
  const range = new Range(Number(loc.from.line) - 1, Number(loc.from.column) - 1, Number(loc.to.line) - 1, Number(loc.to.column));
  const visible = window.visibleTextEditors.find(e => e.document.uri.fsPath === uri.fsPath && e.viewColumn !== undefined);
  try {
    const editor = await window.showTextDocument(uri, {
      viewColumn: visible?.viewColumn ?? ViewColumn.One,
      selection: new Range(range.start, range.start),
      preserveFocus: false,
      preview: false,
    });
    editor.revealRange(range, TextEditorRevealType.InCenterIfOutsideViewport);
  } catch (e) {
    console.log(`Cannot reveal proof step: ${e instanceof Error ? e.message : String(e)}`);
  }
}

class InlineAdapterFactory implements DebugAdapterDescriptorFactory {
  /** The adapters of running sessions, by session id. They run in-process, so views can query them directly. */
  readonly adapters = new Map<string, ProofDebugSession>();

  constructor(private readonly _view: ProofStepView) { }

  createDebugAdapterDescriptor(session: DebugSession): DebugAdapterDescriptor {
    const adapter = new ProofDebugSession(loadGoalState);
    adapter.onDidChangeState = state => {
      if (debug.activeDebugSession && debug.activeDebugSession.id !== session.id)
        return;
      if (!state.finished)
        void revealStep(state);
      this._view.update(state);
    };
    this.adapters.set(session.id, adapter);
    return new DebugAdapterInlineImplementation(adapter);
  }
}

export function register(context: ExtensionContext) {
  context.subscriptions.push(debug.registerDebugConfigurationProvider(debugType, new ConfigurationProvider()));
  const view = new ProofStepView(context);
  const factory = new InlineAdapterFactory(view);
  context.subscriptions.push(view);
  context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory(debugType, factory));

  context.subscriptions.push(debug.onDidStartDebugSession(session => {
    if (session.type === debugType)
      view.reveal();
  }));
  context.subscriptions.push(debug.onDidTerminateDebugSession(session => {
    // The view keeps showing the final state.
    factory.adapters.delete(session.id);
  }));
  // Show the step of the selected stack frame.
  context.subscriptions.push(debug.onDidChangeActiveStackItem(item => {
    if (item instanceof DebugStackFrame && item.session.type === debugType) {
      const state = factory.adapters.get(item.session.id)?.stepState(item.frameId);
      if (state)
        view.update(state);
    }
  }));

  context.subscriptions.push(commands.registerCommand("imandrax.debug_proof", async () => {
    await debug.startDebugging(workspace.workspaceFolders?.[0], {
      type: debugType,
      request: "launch",
      name: "Debug proof at cursor",
    });
  }));
}
