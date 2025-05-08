import {
	workspace,
	window,
	ExtensionContext,
	commands,
	Uri,
	Range,
	TextDocument,
	TextEdit,
	languages,
	DiagnosticChangeEvent,
	DecorationOptions,
	DiagnosticSeverity,
	TextEditor,
	StatusBarAlignment,
	ThemeColor,
	StatusBarItem,
	ViewColumn
} from "vscode";

import CP = require('child_process');
import * as ixcommands from './commands';
import { client } from './lsp_client';
import * as lsp_client from './lsp_client';
import * as vfs from './vfs';


let file_progress_sbi: StatusBarItem = undefined;
let file_progress_text: string = "No tasks";

/** Activate the extension context */
export function activate(context: ExtensionContext) {

	// Register formatter
	languages.registerDocumentFormattingEditProvider("imandrax", {
		provideDocumentFormattingEdits(document: TextDocument): TextEdit[] {
			const config = workspace.getConfiguration("imandrax");
			const cmd_args: string[] = config.lsp.formatter;
			if (!cmd_args || cmd_args.length == 0)
				return [];
			else {
				const out = CP.execSync(cmd_args.join(" ") + " " + document.fileName);
				const rng = new Range(0, 0, document.lineCount, 0);
				document.validateRange(rng);
				return [TextEdit.replace(rng, out.toString())];
			}
		}
	});

	ixcommands.registerCommands(context);
	vfs.activate(context);

	const open_goal_state_cmd = "imandrax.open_goal_state";
	const open_goal_state_handler = async () => {
		const uri = Uri.parse("imandrax-vfs://internal//goal-state.md");
		const doc = await workspace.openTextDocument(uri);
		await window.showTextDocument(doc, { preview: false, viewColumn: ViewColumn.Beside, preserveFocus: true });
		languages.setTextDocumentLanguage(doc, "markdown");
	};
	context.subscriptions.push(commands.registerCommand(open_goal_state_cmd, open_goal_state_handler));

	lsp_client.activate(context);

	languages.onDidChangeDiagnostics(diagnostic_listener, undefined, []);
	window.onDidChangeActiveTextEditor(active_editor_listener, undefined, []);

	const fileProgressCmdId = "file-progress-cmd";
	context.subscriptions.push(commands.registerCommand(fileProgressCmdId, () => {
		window.showInformationMessage(file_progress_text);
	}));

	file_progress_sbi = window.createStatusBarItem(StatusBarAlignment.Right, 0);
	file_progress_sbi.text = "100%";
	file_progress_sbi.command = fileProgressCmdId;
	file_progress_sbi.backgroundColor = undefined;
	context.subscriptions.push(file_progress_sbi);

	file_progress_sbi.show();

	workspace.onDidChangeConfiguration(event => {
		lsp_client.update_configuration(context.extensionUri, event);
	});

	lsp_client.restart({ extensionUri: context.extensionUri, initial: true });
}

function diagnostics_for_editor(editor: TextEditor) {
	let all_good: DecorationOptions[] = [];
	const all_bad: DecorationOptions[] = [];
	const doc = editor.document;
	if (doc !== undefined) {
		languages.getDiagnostics(doc.uri).forEach(d => {
			if (d.source == "lsp") {
				if (editor) {
					const good = d.severity == DiagnosticSeverity.Information || d.severity == DiagnosticSeverity.Hint;
					const range = d.range.with(d.range.start, d.range.start);
					const decoration_options: DecorationOptions = { range: range };
					if (good)
						all_good.push(decoration_options);
					else
						all_bad.push(decoration_options);
				}
			}
		}
		);
		all_good = all_good.filter(x => { return all_bad.find(y => x.range.start.line == y.range.start.line) == undefined; });
		editor.setDecorations(lsp_client.decoration_type_good, all_good);
		editor.setDecorations(lsp_client.decoration_type_bad, all_bad);
	}
}

async function diagnostic_listener(e: DiagnosticChangeEvent) {
	const editor = window.activeTextEditor;
	if (editor !== undefined) {
		const doc = editor.document;
		if (doc !== undefined) {
			if (doc.languageId == "imandrax") {
				diagnostics_for_editor(window.activeTextEditor);
				const file_uri = window.activeTextEditor.document.uri;
				if (file_uri.scheme == "file")
					req_file_progress(file_uri);
				else
					file_progress_sbi.hide();
			}
		}
	}
}

async function active_editor_listener() {
	const editor = window.activeTextEditor;
	if (editor !== undefined) {
		const doc = editor.document;
		if (doc !== undefined) {
			if (doc.languageId == "imandrax") {
				diagnostics_for_editor(window.activeTextEditor);
				const file_uri = doc.uri;
				if (file_uri.scheme == "file") {
					if (client !== undefined && client.isRunning())
						client.sendNotification("$imandrax/active-document", { "uri": file_uri.path });
					req_file_progress(file_uri);
				}
				else
					file_progress_sbi.hide();
			}
			else
				file_progress_sbi.hide();
		}
	}
}

/** Update the status bar with progress reports. */
async function req_file_progress(uri: Uri) {
	if (client && client.isRunning())
		client.sendRequest<string>("$imandrax/req-file-progress", { "uri": uri.path }).then((rsp) => {
			const task_stats = rsp["task_stats"];
			if (task_stats == null) file_progress_sbi.hide(); else {
				try {
					const finished = parseInt(task_stats["finished"]);
					const successful = parseInt(task_stats["successful"]);
					const failed = parseInt(task_stats["failed"]);
					const started = parseInt(task_stats["started"]);
					const total = parseInt(task_stats["total"]);
					if (total == 0) {
						file_progress_sbi.text = "0/0";
						file_progress_sbi.backgroundColor = undefined;
						file_progress_text = "No tasks";
					}
					else {
						file_progress_sbi.text = `${successful}/${total}`;
						if (failed != 0)
							file_progress_sbi.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
						else if (successful != total)
							file_progress_sbi.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
						else
							file_progress_sbi.backgroundColor = undefined;
						file_progress_text = `${started} started, ${finished} finished, ${successful} successful, ${failed} failed, ${total} total tasks.`;
					}
					file_progress_sbi.show();
				} catch (_) {
					file_progress_sbi.hide();
				}
			}
		}, _ => { /* Fine, we'll get it the next time. */ });
}
