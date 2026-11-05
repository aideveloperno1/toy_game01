import { build } from "esbuild";
await build({
  entryPoints: {
    local: "serverless/local.ts",
    "race-worker": "server/race-worker.ts",
  },
  outdir: "dist-server",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
  sourcemap: true,
});
