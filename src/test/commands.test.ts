import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as imandraxLanguageClient from '../imandrax_language_client/imandrax_language_client';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Commands Test Suite', () => {
  suiteTeardown(() => {
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

  test([
    'given some lemmas present,',
    'check all should check them all',
  ].join(' '), async () => {
    // arrange
    const client = imandraxLanguageClient_?.getClient();
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imandrax-tests-'));
    const imlUri = vscode.Uri.file(path.join(workspaceDir, 'demo.iml'));

    const lemmas = `
      lemma add_commutative a b = (a + b) = (b + a)
    `;
    await fs.writeFile(imlUri.fsPath, lemmas, 'utf8');
    const doc = await vscode.workspace.openTextDocument(imlUri);
    await vscode.window.showTextDocument(doc);

    // // act
    await vscode.commands.executeCommand('imandrax.check_all');

    // assert
    // turns out there's no api for getting active decorations, so i'll need to track them myself
    assert(false);
  });
});
