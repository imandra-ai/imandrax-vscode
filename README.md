# ImandraX VSCode extension

This is the VSCode extension for the ImandraX automated reasoning engine and interactive theorem prover. 

* [ImandraX homepage](https://www.imandra.ai/core)
* [ImandraX documentation](https://docs.imandra.ai/imandrax/)

<br/>

![ImandraX](assets/readme/dark/main.png)

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

<picture>
  <source srcset="assets/readme/dark/installer-prompt.png" media="(prefers-color-scheme: dark)">
  <source srcset="assets/readme/light/installer-prompt.png" media="(prefers-color-scheme: light)">
  <img src="assets/readme/dark/installer-prompt.png" alt="Launch installer prompt">
</picture>

If you launch the installer, then you'll see a progress notification for the duration of the
install:

<picture>
  <source srcset="assets/readme/dark/progress-notification.png" media="(prefers-color-scheme: dark)">
  <source srcset="assets/readme/light/progress-notification.png" media="(prefers-color-scheme: light)">
  <img src="assets/readme/dark/progress-notification.png" alt="Progress notification">
</picture>

### Viewing installer logs

The installer is generally silent, but if you want to see the output, it's available
in [VSCode's output panel](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#output-channel)
and [log files](https://code.visualstudio.com/updates/v1_20#_extension-logging):

<picture>
  <source srcset="assets/readme/dark/log-view.png" media="(prefers-color-scheme: dark)">
  <source srcset="assets/readme/light/log-view.png" media="(prefers-color-scheme: light)">
  <img src="assets/readme/dark/log-view.png" alt="Log view">
</picture>

### API key configuration

If everything goes well, then you should prompted to enter your API key
(or, if one was previously configured, to use an existing API key):

<picture>
  <source srcset="assets/readme/dark/api-key-prompt.png" media="(prefers-color-scheme: dark)">
  <source srcset="assets/readme/light/api-key-prompt.png" media="(prefers-color-scheme: light)">
  <img src="assets/readme/dark/api-key-prompt.png" alt="API Key prompt">
</picture>

> Note: API keys are available from https://universe.imandra.ai/user/api-keys.

### Wrapping up

Once the installation is complete, you'll be prompted to reload the window:

<picture>
  <source srcset="assets/readme/dark/done.png" media="(prefers-color-scheme: dark)">
  <source srcset="assets/readme/light/done.png" media="(prefers-color-scheme: light)">
  <img src="assets/readme/dark/done.png" alt="Installation complete">
</picture>

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
