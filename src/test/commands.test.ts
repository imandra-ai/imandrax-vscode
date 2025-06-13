import * as assert from 'assert';
import * as language_client_wrapper from '../language_client_wrapper';

import * as vscode from 'vscode';

suite('Commands Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  let extensionContext: vscode.ExtensionContext | undefined;
  let language_client_wrapper: language_client_wrapper.LanguageClientWrapper | undefined;
  suiteSetup(async () => {
    process.env.NODE_ENV = 'test';
    const ext = vscode.extensions.getExtension('imandra.imandrax');
    await ext!.activate();
    extensionContext = (global as any).testExtensionContext;
    language_client_wrapper = (global as any).testLanguageClientWrapper;
  });

  test([
    'given extension just started,',
    'create terminal should increase',
    'the window.terminals.length by 1'
  ].join(' '), () => {
    const term_count = vscode.window.terminals.length;

    // act
    vscode.commands.executeCommand('imandrax.create_terminal');

    // assert
    assert(vscode.window.terminals.length == term_count + 1);
  });

  test([
    'given client is not undefined,',
    'restart language server should',
    'cause the result of getClient()',
    'to return a new client and',
    'fail the triple equals test'
  ].join(' '), async () => {
    // arrange
    const client = language_client_wrapper?.getClient();

    // act
    await vscode.commands.executeCommand('imandrax.restart_language_server');

    // assert
    assert(client);
    assert(language_client_wrapper?.getClient());
    assert(client !== language_client_wrapper?.getClient());
  });

  test([
    'given client is not undefined,',
    'restart language server should',
    'cause the result of getClient()',
    'to return a new client and',
    'fail the triple equals test'
  ].join(' '), async () => {
    // arrange
    assert(extensionContext != undefined);
    if (extensionContext) {
      const client = language_client_wrapper?.getClient();

      // act
      await vscode.commands.executeCommand('imandrax.restart_language_server');

      // assert
      assert(client);
      assert(language_client_wrapper?.getClient());
      assert(client !== language_client_wrapper?.getClient());
    }
  });
});
