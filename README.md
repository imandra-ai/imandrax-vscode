![ImandraX](https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/main/readme/main.png)

# ImandraX VSCode extension

This is the VSCode extension for the ImandraX automated reasoning engine and interactive theorem prover. 

* [ImandraX homepage](https://www.imandra.ai/core)
* [ImandraX documentation](https://docs.imandra.ai/imandrax/)

## Installing ImandraX

To use the ImandraX extension, an `imandrax-cli` binary must be in your `PATH`. If that's
missing, this extension will prompt you to install it. It will effectively run the script from
http://imandra.ai/get-imandrax.sh with all of the default options.

### Supported platforms

ImandraX is currently supported on MacOS, Linux, and Windows via WSL.
To use this extension on Windows, set up [WSL](https://learn.microsoft.com/en-us/windows/wsl/)
and initiate [VSCode remote development in WSL](https://code.visualstudio.com/docs/remote/wsl-tutorial).

### Opening `.iml` files

Once installed, the ImandraX extension will be enabled whenever you open or create an `.iml` file.

If the ImandraX VSCode extension is installed and `imandrax-cli` is not, then you'll
see something like this the first time you open an `.iml` file:

![Launch installer prompt](https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/main/readme/installer-prompt.png)

If you launch the installer, then you'll see a progress notification for the duration of the
install:

![Progress notification](https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/main/readme/progress-notification.png)

### Viewing installer logs

The installer is generally silent, but if you want to see the output, it's available
in [VSCode's output panel](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#output-channel) 
and [log files](https://code.visualstudio.com/updates/v1_20#_extension-logging):

![Log view](https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/main/readme/log-view.png)

### API key configuration

If everything goes well, then you should prompted to enter your API key
(or, if one was previously configured, to use an existing API key):

![API Key prompt](https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/main/readme/api-key-prompt.png)

> Note: API keys are available from https://universe.imandra.ai/user/api-keys.

### Wrapping up

Once the installation is complete, you'll be prompted to reload the window:

![Installation complete](https://raw.githubusercontent.com/imandra-ai/imandrax-api/refs/heads/main/readme/done.png)

After that, you should be able to use ImandraX.

## Debug settings

If anything goes wrong, you'll want to enable additional output, e.g. by adding
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
