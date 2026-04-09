import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: [
    "src/extension.ts",
    {
      in: "node_modules/@vscode/codicons/dist/codicon.css",
      out: "codicon",
    },
  ],
  bundle: true,
  outdir: "out",
  // outfile: "out/main.js",
  outbase: "src",
  external: ["vscode", "prettier"],
  format: "cjs",
  platform: "node",
  loader: { ".ttf": "copy" },
  metafile: true,
});