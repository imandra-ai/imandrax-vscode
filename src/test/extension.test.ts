import * as assert from 'assert';
import * as language_client_configuration from '../language_client_configuration';
import * as language_client_wrapper from '../language_client_wrapper';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  test('given valid platform and config, the language client starts', async () => {
    const conf = language_client_configuration.get();
    if (language_client_configuration.isFoundPath(conf)) {
      const x = new language_client_wrapper.LanguageClientWrapper(conf);
      await x.start({ extensionUri: vscode.Uri.parse("") });
      assert(x.getClient() != undefined);
    }
  });
});
