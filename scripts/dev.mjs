import { spawn } from "node:child_process";
import "./build-server.mjs";
const children = [
  spawn(process.execPath, ["--watch", "dist-server/local.mjs"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host"], {
    stdio: "inherit",
  }),
];
for (const child of children)
  child.on("exit", () => children.forEach((c) => c.kill()));
process.on("SIGINT", () => children.forEach((c) => c.kill()));
