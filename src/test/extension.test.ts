import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it

import * as language_client_configuration from '../language_client_configuration';
import * as language_client_wrapper from '../language_client_wrapper';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });

  test('client starts', async () => {
    const conf = language_client_configuration.get();
    if (language_client_configuration.isFoundPath(conf)) {
      const x = new language_client_wrapper.LanguageClientWrapper(conf);
      await x.start({ extensionUri: vscode.Uri.parse("") });
      assert(x.getClient() != undefined);
    }
  });
});
