import * as assert from 'assert';
import * as languageClientConfiguration from '../imandrax_language_client/configuration';
import * as languageClientWrapper from '../imandrax_language_client/imandrax_language_client';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  test('given valid platform and config, the language client should start', async () => {
    const conf = languageClientConfiguration.get();
    if (languageClientConfiguration.isFoundPath(conf)) {
      const x = new languageClientWrapper.ImandraxLanguageClient(conf);
      await x.start({ extensionUri: vscode.Uri.parse("") });
      assert(x.getClient() !== undefined);
    }
  });
});
