import { TextDocumentShowOptions, Uri } from "vscode";

export interface ReadyMessage {
  command: "ready";
}

export interface JumpToMessage {
  command: "jump-to";
  arguments: {
    uri: Uri;
    options: TextDocumentShowOptions;
    location: { from: { line: number, column: number }; to: { line: number, column: number } };
  };
}

export interface ExpandMessage {
  command: "expand";
  arguments: {
    id: string;
    po_anchor: string;
  }
}

export type Message = ReadyMessage | JumpToMessage | ExpandMessage;