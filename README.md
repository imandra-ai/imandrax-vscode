# ImandraX VSCode extension

This is the VSCode extension for Imandra's ImandraX automated theorem prover. It
requires `imandrax-cli` in your path, which includes the language server.

## Debug settings

If anything goes wrong, you want to enable additional output, e.g. by adding
something along these lines to your `.vscode/settings.json`:

```
 "imandrax.lsp.arguments": [
    "--debug-lsp",
    "--debug-file=/tmp/lsp.log"
  ],
  "imandrax.lsp.environment": {
    "OCAMLRUNPARAM": "b"
  }
```
