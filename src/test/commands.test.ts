/*
 eslint-disable
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unsafe-member-access
*/

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as util from './util';
import * as vscode from 'vscode';
import { ImandraXLanguageClient } from '../imandrax_language_client/imandrax_language_client';


suite('Commands Test Suite', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  let extensionContext: vscode.ExtensionContext | undefined;
  let imandraxLanguageClient_: ImandraXLanguageClient | undefined;
  suiteSetup(async () => {
    console.log("suite setup")
    const ext = vscode.extensions.getExtension('imandra.imandrax');
    console.log("activate ext");
    await ext!.activate();

    console.log("get globals");
    extensionContext = (global as any).testExtensionContext;
    imandraxLanguageClient_ = (global as any).testLanguageClientWrapper;
    console.log("done with setup");
  });

  test([
    'given extension just started,',
    'create terminal should increase',
    'the window.terminals.length by 1'
  ].join(' '), async () => {
    // arrange
    console.log("get term count");
    const term_count = vscode.window.terminals.length;

    // act
    console.log("execute command");
    await vscode.commands.executeCommand('imandrax.create_terminal');
    // await util.sleep(1_000);

    // assert
    console.log("assert");
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

    extensionContext?.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
      console.log("Active Editor Changed: " + editor?.document.fileName);
    }));

    const doc = await vscode.workspace.openTextDocument(imlUri);
    await vscode.window.showTextDocument(doc);

    // act
    await util.sleep(6_000);
    let startCount = 0;
    let endCount = 0;
    do {
      if (client) {
        client.middleware.handleWorkDoneProgress = (_: any, b: { kind: string; }) => {
          if (b.kind === "begin") {
            startCount += 1;
          }
          if (b.kind === "end") {
            endCount += 1;
          }
        };
      }
      await vscode.commands.executeCommand('imandrax.check_all');
      await util.sleep(1_500);
    }
    while (startCount > endCount);

    // assert
    assert.equal(lemmaCount, endCount);
  });

  test([
    'given client is not undefined,',
    'restart language server should',
    'cause the result of getClient()',
    'to return a new client and',
    'fail the triple equals test'
  ].join(' '), async () => {
    // arrange
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imandrax-tests-'));
    const imlUri = vscode.Uri.file(path.join(workspaceDir, 'demo.iml'));
    await util.sleep(2_000);
    const lemmas = `
        lemma add_commutative a b = (a + b) = (b + a)
      `;
    await fs.writeFile(imlUri.fsPath, lemmas, 'utf8');

    extensionContext?.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
      console.log("Active Editor Changed: " + editor?.document.fileName);
    }));

    const doc = await vscode.workspace.openTextDocument(imlUri);
    await vscode.window.showTextDocument(doc);
    await util.sleep(5_000);

    const previousRestartCount = imandraxLanguageClient_!.getRestartCount(extensionContext!);

    // act
    await vscode.commands.executeCommand('imandrax.restart_language_server');
    await util.sleep(2_000);

    // assert
    assert.notDeepStrictEqual(previousRestartCount, undefined);
    assert.equal(imandraxLanguageClient_!.getRestartCount(extensionContext!), previousRestartCount! + 1,);
  });
});
