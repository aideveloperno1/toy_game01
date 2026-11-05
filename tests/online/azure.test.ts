import { expect, it } from "vitest";
import { AzureStore } from "../../server/storage";
import { join, newRoom } from "../../server/engine";
import { createHash, randomBytes } from "node:crypto";

it.skipIf(!process.env.TEST_AZURITE)(
  "Azure SDK: 큰 한글·이모지 상태, ETag 충돌, Blob 저장과 삭제",
  async () => {
    // Public local-only emulator credential; never an Azure account secret.
    const key = Buffer.from(
      Array.from({ length: 32 }, (_, i) => i + 1),
    ).toString("base64");
    const connection = `DefaultEndpointsProtocol=http;AccountName=gametest;AccountKey=${key};BlobEndpoint=http://127.0.0.1:11000/gametest;TableEndpoint=http://127.0.0.1:11002/gametest;QueueEndpoint=http://127.0.0.1:11001/gametest;`;
    const a = new AzureStore("gametest", connection),
      b = new AzureStore("gametest", connection);
    await a.load();
    const room = newRoom(
      randomBytes(4).toString("hex").toUpperCase(),
      Date.now(),
    );
    join(room, "session", "😀민수", Date.now());
    room.notice = "가나다😀".repeat(14000);
    try {
      await a.save(room, -1);
      const loaded = await b.load();
      const restored = loaded.find((r) => r.code === room.code)!;
      const digest = (s: string) =>
        createHash("sha256").update(s).digest("hex");
      expect({
        length: restored.notice?.length,
        hash: digest(restored.notice ?? ""),
      }).toEqual({ length: room.notice.length, hash: digest(room.notice) });
      expect(restored.members[0].name).toBe(room.members[0].name);
      room.revision = 1;
      await a.save(room, 0);
      expect((await a.load()).find((r) => r.code === room.code)?.revision).toBe(
        1,
      );
      await expect(b.save({ ...room, revision: 2 }, 0)).rejects.toBeDefined();
      await a.asset(room.id, JSON.stringify({ points: [1, 2, 3] }));
      await a.removeAsset(room.id);
    } finally {
      await a.remove(room);
    }
  },
);
