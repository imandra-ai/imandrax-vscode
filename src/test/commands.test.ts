/*
 eslint-disable
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unsafe-member-access
*/

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import { ImandraXLanguageClient } from '../imandrax_language_client/imandrax_language_client';


suite('Commands Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');

    console.log(`Closing all workspaces`);
    const num_wsfolders = vscode.workspace.workspaceFolders?.length;
    vscode.workspace.updateWorkspaceFolders(0, num_wsfolders);
  });

  let extensionContext: vscode.ExtensionContext | undefined;
  let imandraxLanguageClient_: ImandraXLanguageClient | undefined;
  suiteSetup(async () => {
    console.log("suite setup")
    const ext = vscode.extensions.getExtension('imandra.imandrax');
    console.log("activate ext");
    await ext!.activate();

    console.log("get globals");
    extensionContext = (global as any).testExtensionContext;
    imandraxLanguageClient_ = (global as any).testLanguageClientWrapper;
    console.log("done with setup");
  });

  test([
    'given extension just started,',
    'create terminal should increase',
    'the window.terminals.length by 1'
  ].join(' '), async () => {
    // arrange
    console.log("get term count");
    const term_count = vscode.window.terminals.length;

    // act
    console.log("execute command");
    await vscode.commands.executeCommand('imandrax.create_terminal');
    // await util.sleep(1_000);

    // assert
    console.log("assert");
    assert.strictEqual(vscode.window.terminals.length, term_count + 1);
  });


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function set_workspace_config(workspaceDir: string) {
    // For manual testing purposes we may want to change the LSP configuration.

    console.log("opening workspace");
    const num_wsfolders = vscode.workspace.workspaceFolders?.length;
    vscode.workspace.updateWorkspaceFolders(0, num_wsfolders, { uri: vscode.Uri.file(workspaceDir) });

    console.log("changing workspace config");
    let wscfg = vscode.workspace.getConfiguration("imandrax");
    await wscfg.update("lsp.arguments", [
      "lsp",
      "--check-on-save=false",
      "--unicode=true",
      "--log-level=info",
      // "--log-file=test-lsp.log",
      // "--log-jsonrpc=test-lsp.jrpc",
      // "--deployment=prod"
    ]).then(
      () => { console.log("changing workspace config was successful"); },
      (e) => { console.log(`changing workspace config failed: ${e}`); });

    wscfg = vscode.workspace.getConfiguration("imandrax");
    console.log(`workspace config: ${JSON.stringify(wscfg)}`);
  }

  test('given one lemma, check all should report one task completed', async () => {
    // arrange
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imandrax-tests-'));

    // await set_workspace_config(workspaceDir);

    const client = imandraxLanguageClient_?.getClient();
    const filename = "demo.iml";
    const imlUri = vscode.Uri.file(path.join(workspaceDir, filename));

    assert(client, "client unexpectedly failed to materialize");

    let resolveSawDiagnostic: (value: boolean | PromiseLike<boolean>) => void;
    const sawProvedDiagnostic = new Promise<boolean>((resolve) => {
      resolveSawDiagnostic = resolve;
    });

    client.middleware.handleDiagnostics = (uri, ds: vscode.Diagnostic[]) => {
      if (ds.length > 0) {
        // console.log(`Diagnostics for ${JSON.stringify(uri)}: ${JSON.stringify(ds)}`);
        if (uri.path.endsWith(filename)) {
          ds.forEach((d) => {
            if (d.severity == vscode.DiagnosticSeverity.Hint &&
              d.message.startsWith("Proved") && d.range.start.line === 1)
              resolveSawDiagnostic(true);
          });
        }
        // We received some diagnostics, but they were not for us
        resolveSawDiagnostic(false);
      }
    }

    const lemmaCount = 1;
    let startCount = 0;
    let endCount = 0;
    let resolveSawProgressNotifications: (value: boolean | PromiseLike<boolean>) => void;
    const sawProgressNotifications = new Promise<boolean>((resolve) => {
      resolveSawProgressNotifications = resolve;
    });

    client.middleware.handleWorkDoneProgress = (token, params) => {
      console.log(`WorkDoneProgress event: ${params.kind}`);
      if (params.kind === "begin")
        startCount += 1;
      if (params.kind === "end")
        endCount += 1;
      if (startCount == lemmaCount && endCount == lemmaCount)
        resolveSawProgressNotifications(true);
    };

    console.log("WorkDoneProgress handler installed");

    extensionContext?.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
      console.log("Active Editor Changed: " + editor?.document.fileName);
    }));

    console.log("onDidChangeActiveTextEditor handler installed");

    const lemmas = `
        lemma add_commutative a b = (a + b) = (b + a)
      `;
    await fs.writeFile(imlUri.fsPath, lemmas, 'utf8');

    const doc = await vscode.workspace.openTextDocument(imlUri);
    await vscode.window.showTextDocument(doc);

    console.log("Checking all");
    await vscode.commands.executeCommand('imandrax.check_all');

    await util.withTimeout(sawProvedDiagnostic, 5000).then((q) => {
      assert(q, "expected a diagnostic to confirm success, but did not receive one")
    }).catch((err) => {
      assert(false, `sawProvedDiagnostic rejected: ${err}`)
    });

    // Prod does not reliably send progress notifications currently, so this test is disabled.
    // await util.withTimeout(sawProgressNotifications, 5000).then((q) => {
    //   assert(q, `expected ${lemmaCount} new task notification(s), but did not receive them`)
    // }).catch((err) => {
    //   assert(false, `sawProgressNotifications rejected: ${err}`)
    // })
  });

  test([
    'given client is not undefined,',
    'restart language server should',
    'cause the result of getClient()',
    'to return a new client and',
    'fail the triple equals test'
  ].join(' '), async () => {
    // arrange
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imandrax-tests-'));
    const imlUri = vscode.Uri.file(path.join(workspaceDir, 'demo.iml'));
    await util.sleep(2_000);
    const lemmas = `
        lemma add_commutative a b = (a + b) = (b + a)
      `;
    await fs.writeFile(imlUri.fsPath, lemmas, 'utf8');

    extensionContext?.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
      console.log("Active Editor Changed: " + editor?.document.fileName);
    }));

    const doc = await vscode.workspace.openTextDocument(imlUri);
    await vscode.window.showTextDocument(doc);
    await util.sleep(5_000);

    const previousRestartCount = imandraxLanguageClient_!.getRestartCount(extensionContext!);

    // act
    await vscode.commands.executeCommand('imandrax.restart_language_server');
    await util.sleep(2_000);

    // assert
    assert.notDeepStrictEqual(previousRestartCount, undefined);
    assert.equal(imandraxLanguageClient_!.getRestartCount(extensionContext!), previousRestartCount! + 1,);
  });
});
