import * as assert from 'assert';
import * as imandraxLanguageClient from '../imandrax_language_client/imandrax_language_client';
import * as vscode from 'vscode';


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
