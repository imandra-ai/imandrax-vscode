import { OutputChannel, ViewColumn } from 'vscode';

export class TestOutputChannel implements OutputChannel {
  readonly name = "ImandraX Test";

  public append(value: string) {
    console.log(value);
  }

  public appendLine(value: string): void {
    console.log(value);
  }

  public clear(): void {
    console.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public show(column?: ViewColumn | boolean, preserveFocus?: boolean): void {
    return;
  }

  public hide(): void {
    return;
  }

  public dispose(): void {
    return;
  }

  public replace(value: string): void {
    console.log(`REPLACE: ${value}`)
  }
}
