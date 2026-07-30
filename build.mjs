import * as esbuild from "esbuild";

const sourcemap = process.argv.includes("--sourcemap");
const minify = process.argv.includes("--minify");
const watch = process.argv.includes("--watch");

const config = {
  entryPoints: [
    "src/extension.ts",
    {
      in: "node_modules/@vscode/codicons/dist/codicon.css",
      out: "codicon",
    },
  ],
  bundle: true,
  outdir: "out",
  outbase: "src",
  external: ["vscode", "prettier"],
  format: "cjs",
  platform: "node",
  loader: { ".ttf": "copy" },
  metafile: true,
  sourcemap: sourcemap ? "linked" : false,
  minify: minify,
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
} else {
  await esbuild.build(config);
}