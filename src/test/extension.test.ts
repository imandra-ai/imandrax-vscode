import * as assert from 'assert';
import * as languageClientConfiguration from '../language_client_configuration';
import * as languageClientWrapper from '../language_client_wrapper';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  test('given valid platform and config, the language client should start', async () => {
    const conf = languageClientConfiguration.get();
    if (languageClientConfiguration.isFoundPath(conf)) {
      const x = new languageClientWrapper.LanguageClientWrapper(conf);
      await x.start({ extensionUri: vscode.Uri.parse("") });
      assert(x.getClient() !== undefined);
    }
  });
});
