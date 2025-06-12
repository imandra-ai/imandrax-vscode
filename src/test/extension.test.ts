import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it

import * as language_client_configuration from '../language_client_configuration';
import * as language_client_wrapper from '../language_client_wrapper';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  const f = language_client_configuration.get();
  if (language_client_configuration.isFoundPath(f)) {
    const x = new language_client_wrapper.LanguageClientWrapper(f);
    console.log(x);
  }
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});
