import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as imandraxLanguageClient from '../imandrax_language_client/imandrax_language_client';
import * as listeners from '../listeners';
import * as os from 'os';
import * as path from 'path';
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
import * as util from '../util';
import * as vscode from 'vscode';
import { HandleWorkDoneProgressSignature, ProgressToken, WorkDoneProgressBegin, WorkDoneProgressEnd, WorkDoneProgressReport } from 'vscode-languageclient';



suite('Commands, Simple Test Suite', () => {
  suiteTeardown(async () => {
    vscode.window.showInformationMessage('All tests done!');
  });

  let extensionContext: vscode.ExtensionContext | undefined;
  let imandraxLanguageClient_: imandraxLanguageClient.ImandraxLanguageClient | undefined;
  suiteSetup(async () => {
    // this is needed for running tests, but not for debugging them
    const ext = vscode.extensions.getExtension('imandra.imandrax');
    await ext!.activate();
    // fin

    extensionContext = (global as any).testExtensionContext;
    imandraxLanguageClient_ = (global as any).testLanguageClientWrapper;
  });

  test([
    'given extension just started,',
    'create terminal should increase',
    'the window.terminals.length by 1'
  ].join(' '), async () => {
    // arrange 
    const term_count = vscode.window.terminals.length;

    // act
    vscode.commands.executeCommand('imandrax.create_terminal');

    // assert
    assert.strictEqual(vscode.window.terminals.length, term_count + 1);
  });

  test('given one lemma, check all should report one task completed', async () => {
    // arrange
    const client = imandraxLanguageClient_?.getClient();
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imandrax-tests-'));
    const imlUri = vscode.Uri.file(path.join(workspaceDir, 'demo.iml'));

    const lemmaCount = 1;
    const lemmas = `
        lemma add_commutative a b = (a + b) = (b + a)
      `;
    await fs.writeFile(imlUri.fsPath, lemmas, 'utf8');
    const doc = await vscode.workspace.openTextDocument(imlUri);
    await vscode.window.showTextDocument(doc);

    // act
    // it would be better to be able to wait for the extension to actually start up
    await util.sleep(10_000);
    let ends = 0;
    if (client) {
      client.middleware.handleWorkDoneProgress = (a, b, c) => {
        if (b.kind === "end") {
          ends += 1;
        }
      };
    }
    await vscode.commands.executeCommand('imandrax.check_all');
    await util.sleep(10_000);

    // assert
    assert.equal(lemmaCount, ends);
  });

  // seb 6-20-25
  // putting this test above 'given one lemma, check all should report one task completed'
  // causes it to fail, so make sure to keep it below.
  test([
    'given client is not undefined,',
    'restart language server should',
    'cause the result of getClient()',
    'to return a new client and',
    'fail the triple equals test'
  ].join(' '), async () => {
    // arrange
    const previousRestartCount = imandraxLanguageClient_!.getRestartCount(extensionContext!);

    // act
    await vscode.commands.executeCommand('imandrax.restart_language_server');

    // assert
    assert.notDeepStrictEqual(previousRestartCount, undefined);
    assert.equal(previousRestartCount! + 1, imandraxLanguageClient_!.getRestartCount(extensionContext!));
  });
});
