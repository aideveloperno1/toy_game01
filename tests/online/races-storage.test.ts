import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import {
  applyCommand,
  begin,
  join,
  newRoom,
  tick,
  type Game,
} from "../../server/engine";
import { buildRace, frame } from "../../server/races";
import { FileRepository } from "../../serverless/repository";
import { FunctionRoomService, type StoredRoom } from "../../serverless/service";
import type { Command, OnlineGame } from "../../shared/protocol";
const command = (c: Omit<Command, "id">): Command => ({
  id: randomUUID(),
  ...c,
});
function game(id: OnlineGame, n: number) {
  const r = newRoom("XYZ234", 1000);
  for (let i = 0; i < n; i++) join(r, `sid${i}`, `사람${i}`, 1000);
  applyCommand(
    r,
    r.hostId,
    command({ type: "configure", game: id, config: { mode: "rank" } }),
    1000,
  );
  for (const m of r.members)
    applyCommand(r, m.id, command({ type: "ready", ready: true }), 1000);
  applyCommand(r, r.hostId, command({ type: "prepare" }), 1000);
  return r;
}
describe("경주와 실제 디스크 복구", () => {
  it("구슬 워커가 30명 경로를 계산하고 현재 프레임만 공개한다", async () => {
    const r = game("marble", 30),
      g = r.gameState!;
    const asset = await buildRace(g);
    begin(r, 1000, asset.duration);
    expect(asset.marble!.order).toHaveLength(30);
    expect(asset.duration).toBeLessThanOrEqual(92000);
    const sample = frame(g, asset, g.startAt + 1000);
    expect(sample.points).toHaveLength(30);
    expect(sample.points.map((p) => p.id)).toEqual(
      g.round.participants.map((p) => p.id),
    );
    expect(JSON.stringify(sample)).not.toContain("finishFrame");
    expect(JSON.stringify(sample)).not.toContain(g.round.seed);
    tick(r, g.deadline);
    expect(r.phase).toBe("result");
  });
  it("동물 경주의 레인 번호가 비공개 순위가 아닌 참가 순서이다", async () => {
    const r = game("horse", 12),
      g = r.gameState as Game;
    const asset = await buildRace(g);
    const sample = frame(g, asset, 1000);
    expect(sample.points.map((p) => p.y)).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    );
    expect(sample.points.every((p) => p.x === 0)).toBe(true);
  });
  it("원자적 파일 저장 뒤 새 프로세스 상태로 결과를 복구한다", async () => {
    const root = await mkdtemp(pathJoin(tmpdir(), "room-game-test-"));
    try {
      const store = new FileRepository(root),
        r = game("ladder", 3);
      begin(r, 1000);
      tick(r, r.gameState!.deadline);
      const stored: StoredRoom = { ...r, creationKey: "test", presence: {} };
      expect(await store.put("rooms/" + r.code, stored, null)).toBe(true);
      expect(await store.put("rooms/" + r.code, stored, null)).toBe(false);
      const svc = new FunctionRoomService(
        new FileRepository(root),
        undefined,
        () => 40000,
      );
      const restored = await svc.operate(r.code, "sid0", "tab", "sync");
      expect(restored.room.results).toEqual(r.results);
      expect((await svc.member(r.code, "sid0")).room.completed).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    "ladder",
    "roulette",
    "horse",
    "cards",
    "pirate",
    "bomb",
    "scratch",
    "stopwatch",
    "marble",
  ] as OnlineGame[])(
    "%s: 순위와 항목 배정에서 전체 인원의 결과를 보존한다",
    (id) => {
      const r = game(id, 4);
      begin(r, 1000);
      let loops = 0;
      while (r.phase === "playing" && loops++ < 500)
        tick(r, r.gameState!.deadline);
      expect(r.phase).toBe("result");
      expect(
        Object.values(r.results!)
          .map((s) => s.rank)
          .sort(),
      ).toEqual([1, 2, 3, 4]);
    },
  );
});
