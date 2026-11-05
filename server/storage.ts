import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import type { Room } from "./engine";

export interface Store {
  load(): Promise<Room[]>;
  save(room: Room, expectedRevision: number): Promise<void>;
  remove(room: Room): Promise<void>;
  asset(id: string, data: string): Promise<void>;
  removeAsset(id: string): Promise<void>;
}
export class MemoryStore implements Store {
  data = new Map<string, Room>();
  async load() {
    return structuredClone([...this.data.values()]);
  }
  async save(room: Room, expected: number) {
    if ((this.data.get(room.code)?.revision ?? -1) !== expected)
      throw new Error("저장 버전 충돌");
    this.data.set(room.code, structuredClone(room));
  }
  async remove(room: Room) {
    this.data.delete(room.code);
  }
  async asset(_id: string, _data: string) {}
  async removeAsset(_id: string) {}
}
export class FileStore implements Store {
  constructor(private root: string) {}
  async load() {
    await mkdir(this.root, { recursive: true });
    const files = (await readdir(this.root)).filter((f) =>
      f.endsWith(".room.json"),
    );
    return Promise.all(
      files.map(
        async (f) =>
          JSON.parse(await readFile(join(this.root, f), "utf8")) as Room,
      ),
    );
  }
  async save(room: Room, expected: number) {
    await mkdir(this.root, { recursive: true });
    const file = join(this.root, `${room.code}.room.json`);
    let old = -1;
    try {
      old = (JSON.parse(await readFile(file, "utf8")) as Room).revision;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (old !== expected) throw new Error("저장 버전 충돌");
    const temp = file + ".tmp";
    await writeFile(temp, JSON.stringify(room), { mode: 0o600 });
    await rename(temp, file);
  }
  async remove(room: Room) {
    await unlink(join(this.root, `${room.code}.room.json`)).catch(
      ignoreMissing,
    );
  }
  async asset(id: string, data: string) {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, `${id}.asset.json`), data);
  }
  async removeAsset(id: string) {
    await unlink(join(this.root, `${id}.asset.json`)).catch(ignoreMissing);
  }
}
function ignoreMissing(e: NodeJS.ErrnoException) {
  if (e.code !== "ENOENT") throw e;
}
export class AzureStore implements Store {
  private table: TableClient;
  private blobs;
  private etags = new Map<string, string>();
  constructor(account: string, connectionString?: string) {
    const credential = new DefaultAzureCredential();
    const localEmulator =
      process.env.NODE_ENV !== "production" &&
      !!connectionString?.includes("TableEndpoint=http://127.0.0.1:");
    this.table = connectionString
      ? TableClient.fromConnectionString(connectionString, "GameRooms", {
          allowInsecureConnection: localEmulator,
        })
      : new TableClient(
          `https://${account}.table.core.windows.net`,
          "GameRooms",
          credential,
        );
    this.blobs = (
      connectionString
        ? BlobServiceClient.fromConnectionString(connectionString)
        : new BlobServiceClient(
            `https://${account}.blob.core.windows.net`,
            credential,
          )
    ).getContainerClient("game-replays");
  }
  async load() {
    await this.table.createTable();
    await this.blobs.createIfNotExists();
    const rooms: Room[] = [];
    for await (const entity of this.table.listEntities<
      Record<string, unknown>
    >()) {
      if (entity.partitionKey !== "rooms") continue;
      const text = Array.from(
        { length: Number(entity.parts) },
        (_, i) => entity[`p${i}`] as string,
      ).join("");
      const json =
        entity.encoding === "gzip-base64"
          ? gunzipSync(Buffer.from(text, "base64"), {
              maxOutputLength: 2000000,
            }).toString("utf8")
          : text;
      const room = JSON.parse(json) as Room;
      rooms.push(room);
      this.etags.set(room.code, entity.etag!);
    }
    return rooms;
  }
  async save(room: Room, expected: number) {
    const json = JSON.stringify(room);
    if (Buffer.byteLength(json) > 1800000)
      throw new Error("방 저장 용량 한도를 넘었어요.");
    // ASCII chunks avoid UTF-8 stream-boundary corruption and stay below Table property/entity limits.
    const encoded = gzipSync(Buffer.from(json, "utf8")).toString("base64");
    if (encoded.length > 400000)
      throw new Error("방 저장 용량 한도를 넘었어요.");
    const entity: Record<string, unknown> & {
      partitionKey: string;
      rowKey: string;
    } = {
      partitionKey: "rooms",
      rowKey: room.code,
      parts: Math.ceil(encoded.length / 30000),
      revision: room.revision,
      encoding: "gzip-base64",
    };
    for (let i = 0; i < Number(entity.parts); i++)
      entity[`p${i}`] = encoded.slice(i * 30000, (i + 1) * 30000);
    if (expected === -1) {
      const response = await this.table.createEntity(entity);
      this.etags.set(room.code, response.etag!);
    } else {
      const etag = this.etags.get(room.code);
      if (!etag) throw new Error("저장 상태를 확인할 수 없어요.");
      const response = await this.table.updateEntity(entity, "Replace", {
        etag,
      });
      this.etags.set(room.code, response.etag!);
    }
  }
  async remove(room: Room) {
    await this.table.deleteEntity("rooms", room.code, {
      etag: this.etags.get(room.code),
    });
    this.etags.delete(room.code);
  }
  async asset(id: string, data: string) {
    await this.blobs
      .getBlockBlobClient(id)
      .upload(data, Buffer.byteLength(data));
  }
  async removeAsset(id: string) {
    await this.blobs
      .deleteBlob(id, { deleteSnapshots: "include" })
      .catch((e) => {
        if (e.statusCode !== 404) throw e;
      });
  }
}
