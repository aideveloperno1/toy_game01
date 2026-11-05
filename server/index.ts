import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { AzureStore, FileStore } from "./storage";
import { RoomService } from "./service";
import { createApp } from "./http";

try {
  process.loadEnvFile();
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const production = process.env.NODE_ENV === "production";
const root = resolve(process.env.DATA_DIR ?? ".data");
const account = process.env.AZURE_STORAGE_ACCOUNT;
if (
  production &&
  (!account || !process.env.SESSION_SECRET || !process.env.APP_ORIGIN)
)
  throw new Error(
    "운영 환경에는 AZURE_STORAGE_ACCOUNT, SESSION_SECRET, APP_ORIGIN이 필요합니다.",
  );
let secret = process.env.SESSION_SECRET;
if (!secret) {
  await mkdir(root, { recursive: true });
  try {
    secret = await readFile(resolve(root, "session-secret"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    secret = randomBytes(32).toString("hex");
    await writeFile(resolve(root, "session-secret"), secret, { mode: 0o600 });
  }
}
if (secret.length < 32)
  throw new Error("SESSION_SECRET은 32자 이상이어야 합니다.");
const store = account
  ? new AzureStore(account, process.env.AZURE_STORAGE_CONNECTION_STRING)
  : new FileStore(root);
const service = new RoomService(store);
await service.initialize();
const server = createApp(service, secret, {
  production,
  origin: process.env.APP_ORIGIN,
  maintenance: process.env.MAINTENANCE === "1",
  adminToken: process.env.ADMIN_TOKEN,
});
const port = Number(process.env.PORT ?? 3001);
server.http.listen(port, "0.0.0.0", () =>
  console.log(`게임 서버: http://localhost:${port}`),
);
const shutdown = () => {
  void server.close().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
