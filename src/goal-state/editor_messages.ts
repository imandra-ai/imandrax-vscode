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
    anchor: string;
  }
}

export interface FocusLockOntoMessage {
  command: "focus-lock-onto";
  arguments: {
    anchor: string | undefined;
  }
}

export interface ResizeMessage {
  command: "resize";
  arguments: {
    width: number;
    font_size: number;
  }
}

export type Message = ReadyMessage | JumpToMessage | ExpandMessage | FocusLockOntoMessage | ResizeMessage;