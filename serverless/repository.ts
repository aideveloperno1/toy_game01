import { BlobServiceClient } from "@azure/storage-blob";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type Document<T> = { value: T; etag: string };
export interface Repository {
  get<T>(key: string): Promise<Document<T> | undefined>;
  put<T>(key: string, value: T, etag: string | null): Promise<boolean>;
}
export class MemoryRepository implements Repository {
  data = new Map<string, Document<unknown>>();
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as Document<T> | undefined;
  }
  async put<T>(key: string, value: T, etag: string | null) {
    if ((this.data.get(key)?.etag ?? null) !== etag) return false;
    this.data.set(key, { value: structuredClone(value), etag: randomUUID() });
    return true;
  }
}
// Local development only. Azure uses conditional Blob writes across function instances.
export class FileRepository implements Repository {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private path(key: string) {
    return join(this.root, Buffer.from(key).toString("base64url") + ".json");
  }
  async get<T>(key: string): Promise<Document<T> | undefined> {
    try {
      return JSON.parse(await readFile(this.path(key), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
  put<T>(key: string, value: T, etag: string | null): Promise<boolean> {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        if (((await this.get(key))?.etag ?? null) !== etag) return false;
        await mkdir(this.root, { recursive: true });
        const path = this.path(key),
          temp = path + "." + randomUUID() + ".tmp";
        await writeFile(temp, JSON.stringify({ value, etag: randomUUID() }), {
          mode: 0o600,
        });
        await rename(temp, path);
        return true;
      });
    this.writes = task;
    return task;
  }
}
export class BlobRepository implements Repository {
  private container;
  private initialized?: Promise<unknown>;
  constructor(connection: string, container = "game-state") {
    this.container = BlobServiceClient.fromConnectionString(connection, {
      retryOptions: { maxTries: 2, tryTimeoutInMs: 5000 },
    }).getContainerClient(container);
  }
  private async ready() {
    this.initialized ??= this.container.createIfNotExists();
    try {
      await this.initialized;
    } catch (e) {
      this.initialized = undefined;
      throw e;
    }
  }
  async get<T>(key: string): Promise<Document<T> | undefined> {
    await this.ready();
    try {
      const response = await this.container.getBlobClient(key).download();
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody!)
        chunks.push(Buffer.from(chunk));
      return {
        value: JSON.parse(
          gunzipSync(Buffer.concat(chunks), {
            maxOutputLength: 16000000,
          }).toString("utf8"),
        ),
        etag: response.etag!,
      };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return;
      throw e;
    }
  }
  async put<T>(key: string, value: T, etag: string | null) {
    await this.ready();
    const body = gzipSync(Buffer.from(JSON.stringify(value)));
    if (body.length > 8000000) throw new Error("저장 용량 한도를 넘었어요.");
    try {
      await this.container.getBlockBlobClient(key).uploadData(body, {
        conditions: etag === null ? { ifNoneMatch: "*" } : { ifMatch: etag },
        blobHTTPHeaders: { blobContentType: "application/gzip" },
      });
      return true;
    } catch (e) {
      if ([409, 412].includes((e as { statusCode: number }).statusCode))
        return false;
      throw e;
    }
  }
}
