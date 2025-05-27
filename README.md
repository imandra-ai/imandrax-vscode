# ImandraX VSCode extension

This is the VSCode extension for Imandra's ImandraX automated theorem prover. It
requires `imandrax-cli` in your path, which includes the language server. If that's
missing, this extension will prompt you to install it. It's effectively running the script from
http://imandra.ai/get-imandrax.sh, with all of the default responses to questions.

If the ImandraX VSCode extension is installed and `imandrax-cli` is not, then you'll
see something like this the first time you open an `.iml` file:

![Launch installer prompt](assets/readme-1.png)

If you launch the installer, then you'll see a progress window for the duration of the
install:

![Progress window](assets/readme-2.png)

The installer is generally silent, but if you want to see the output, it's available
in VSCode's output window and log files:

![Log view](assets/readme-5.png)


If everything goes well, then you should prompted to enter your API key (or use an 
existing API key if, one was previously configured):

![API Key prompt](assets/readme-3.png)

> Note: API keys are available from https://universe.imandra.ai/user/api-keys.

Once the installation is complete, you'll be prompted to reload the window:

![Installation complete](assets/readme-4.png)

After that, you should be able to use ImandraX.

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
