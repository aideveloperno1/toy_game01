import express from "express";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createApi } from "./api";
import { BlobRepository, FileRepository } from "./repository";
import { FunctionRoomService, noNotifications } from "./service";
import { AzureNotifications } from "./pubsub";
try {
  process.loadEnvFile();
} catch {
  /* Optional local settings. */
}
const root = resolve(process.env.DATA_DIR ?? ".data/swa");
await mkdir(root, { recursive: true });
const secretPath = resolve(root, "session-secret");
let secret = process.env.SESSION_SECRET;
if (!secret) {
  try {
    secret = await readFile(secretPath, "utf8");
  } catch {
    secret = randomBytes(48).toString("hex");
    await writeFile(secretPath, secret, { mode: 0o600 });
  }
}
const repository = process.env.GAME_STORAGE_CONNECTION_STRING
  ? new BlobRepository(process.env.GAME_STORAGE_CONNECTION_STRING)
  : new FileRepository(root);
const notifications = process.env.WEB_PUBSUB_CONNECTION_STRING
  ? new AzureNotifications(process.env.WEB_PUBSUB_CONNECTION_STRING)
  : noNotifications;
const api = createApi(
  new FunctionRoomService(repository, notifications),
  secret,
);
const app = express();
app.use(
  "/api",
  express.text({ type: "*/*", limit: "16kb" }),
  async (req, res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const response = await api(
      new Request("http://localhost" + req.originalUrl, {
        method: req.method,
        headers,
        body: req.method === "POST" ? req.body : undefined,
      }),
    );
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.status(response.status).send(await response.text());
  },
);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0", () =>
  console.log("Static Web Apps local API ready"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit()));
