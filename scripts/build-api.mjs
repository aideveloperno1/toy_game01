import { build } from "esbuild";
await build({
  entryPoints: {
    functions: "serverless/functions.ts",
    "race-worker": "server/race-worker.ts",
  },
  outdir: "api/dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
  sourcemap: true,
});
