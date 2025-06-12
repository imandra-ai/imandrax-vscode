import * as decorations from './decorations';

import { commands, DecorationOptions, DiagnosticChangeEvent, DiagnosticSeverity, ExtensionContext, languages, StatusBarAlignment, StatusBarItem, TextEditor, ThemeColor, Uri, window } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

let file_progress_text: string = "No tasks";

export class Listeners {
  file_progress_sbi: StatusBarItem;
  getClient: () => LanguageClient;

  constructor(context: ExtensionContext, getClient: () => LanguageClient) {
    // todo seb should this be here, or in commands?
    const fileProgressCmdId = "file-progress-cmd";
    context.subscriptions.push(commands.registerCommand(fileProgressCmdId, () => {
      window.showInformationMessage(file_progress_text);
    }));

    this.file_progress_sbi = window.createStatusBarItem(StatusBarAlignment.Right, 0);
    this.file_progress_sbi.text = "100%";
    this.file_progress_sbi.command = fileProgressCmdId;
    this.file_progress_sbi.backgroundColor = undefined;
    context.subscriptions.push(this.file_progress_sbi);

    this.file_progress_sbi.show();

    this.getClient = getClient;
  }

  diagnostics_for_editor(editor: TextEditor) {
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
      editor.setDecorations(decorations.decoration_type_good, all_good);
      editor.setDecorations(decorations.decoration_type_bad, all_bad);
    }
  }

  async req_file_progress(uri: Uri) {
    if (this.getClient() && this.getClient().isRunning())
      this.getClient().sendRequest<string>("$imandrax/req-file-progress", { "uri": uri.path }).then((rsp: any) => {
        const task_stats = rsp["task_stats"];
        if (task_stats == null) this.file_progress_sbi.hide(); else {
          try {
            const finished = parseInt(task_stats["finished"]);
            const successful = parseInt(task_stats["successful"]);
            const failed = parseInt(task_stats["failed"]);
            const started = parseInt(task_stats["started"]);
            const total = parseInt(task_stats["total"]);
            if (total == 0) {
              this.file_progress_sbi.text = "0/0";
              this.file_progress_sbi.backgroundColor = undefined;
              file_progress_text = "No tasks";
            }
            else {
              this.file_progress_sbi.text = `${successful}/${total}`;
              if (failed != 0)
                this.file_progress_sbi.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
              else if (successful != total)
                this.file_progress_sbi.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
              else
                this.file_progress_sbi.backgroundColor = undefined;
              file_progress_text = `${started} started, ${finished} finished, ${successful} successful, ${failed} failed, ${total} total tasks.`;
            }
            this.file_progress_sbi.show();
          } catch (_) {
            this.file_progress_sbi.hide();
          }
        }
      }, _ => { /* Fine, we'll get it the next time. */ });
  }

  async diagnostic_listener(e: DiagnosticChangeEvent) {
    const editor = window.activeTextEditor;
    if (editor !== undefined) {
      const doc = editor.document;
      if (doc !== undefined) {
        if (doc.languageId == "imandrax") {
          this.diagnostics_for_editor(editor);
          const file_uri = editor.document.uri;
          if (file_uri.scheme == "file")
            this.req_file_progress(file_uri);
          else
            this.file_progress_sbi.hide();
        }
      }
    }
  }

  async active_editor_listener() {
    const editor = window.activeTextEditor;
    if (editor !== undefined) {
      const doc = editor.document;
      if (doc !== undefined) {
        if (doc.languageId == "imandrax") {
          this.diagnostics_for_editor(editor);
          const file_uri = doc.uri;
          if (file_uri.scheme == "file") {
            if (this.getClient() !== undefined && this.getClient().isRunning())
              this.getClient().sendNotification("$imandrax/active-document", { "uri": file_uri.path });
            this.req_file_progress(file_uri);
          }
          else
            this.file_progress_sbi.hide();
        }
        else
          this.file_progress_sbi.hide();
      }
    }
  }

  public register() {
    languages.onDidChangeDiagnostics((e) => { this.diagnostic_listener(e); }, undefined, []);
    window.onDidChangeActiveTextEditor(() => { this.active_editor_listener(); }, undefined, []);
  }
}
