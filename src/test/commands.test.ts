import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Commands Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  let extensionContext: vscode.ExtensionContext | undefined;
  suiteSetup(async () => {
    process.env.NODE_ENV = 'test';
    const ext = vscode.extensions.getExtension('imandra.imandrax');
    await ext!.activate();
    extensionContext = (global as any).testExtensionContext;
  });

  test('given extension just started, create terminal should increase the window.terminals.length by 1', () => {
    // arrange
    assert(extensionContext != undefined);
    if (extensionContext) {
      const term_count = vscode.window.terminals.length;

      // act
      vscode.commands.executeCommand('imandrax.create_terminal');

      // assert
      assert(vscode.window.terminals.length == term_count + 1);
    }
  });
});
