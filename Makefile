

build:
	npm i

# see https://code.visualstudio.com/api/working-with-extensions/bundling-extension#using-esbuild
distrib:
	npm x vsce package
