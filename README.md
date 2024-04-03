# Imandrax LSP plugin

You need `imandrax-lsp` in your path.

## Functionality

This works for `.iml` files, with basic syntax coloring, and the few methods
that `imandrax-lsp` handles (for now).

## TODO

- [ ] config for check-on-save off/on (currently always on)
- [ ] config to decide where to schedule tasks (cloud account? ssh to another machine?)
- [ ] proper tracing through LSP itself (see https://github.com/c-cube/linol/discussions/28)

## Running for development

- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to start compiling the client and server in [watch mode](https://code.visualstudio.com/docs/editor/tasks#:~:text=The%20first%20entry%20executes,the%20HelloWorld.js%20file.).
- Switch to the Run and Debug View in the Sidebar (Ctrl+Shift+D).
- Select `Launch Client` from the drop down (if it is not already).
- Press ▷ to run the launch config (F5).
- Open some .iml files.

## Debug settings

Add this to your `.vscode/settings.json`:

```
 "imandrax.lsp.arguments": [
    "--debug-lsp",
    "--debug-file=/tmp/lsp.log"
  ],
  "imandrax.lsp.environment": {
    "OCAMLRUNPARAM": "b"
  }
```
