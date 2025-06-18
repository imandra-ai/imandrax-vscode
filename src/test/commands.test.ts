import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as imandraxLanguageClient from '../imandrax_language_client/imandrax_language_client';
import * as os from 'os';
import * as path from 'path';
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
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
    const dbPath = path.resolve("/Users/sebastianprovenzano/Documents/git/imandrax-vscode/.vscode-test/db/imandrax.sqlite");
    const db = await sqlite.open({ filename: dbPath, driver: sqlite3.cached.Database });

    const rows: { event: string, id: string, meta: string, time: string }[] = await db
      .all('SELECT * FROM task_events');

    await db.close();

    console.log(rows);

    const meta = rows.at(-1)?.meta;

    // it would be better to have a programmatic way of linking
    // items in the db to lemmas in the file
    const time_str = rows.at(-1)?.time;
    const recent = time_str
      ? (Date.now() >= new Date(time_str).getTime()
        && (Date.now() - new Date(time_str).getTime()) <= 30_000)
      : false;

    // assert
    assert.equal(meta, '{"success":true}');
    assert(recent);
  });
});
