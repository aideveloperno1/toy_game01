import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  applyCommand,
  begin,
  current,
  disconnect,
  join,
  newRoom,
  publicView,
  tick,
  type Room,
} from "../../server/engine";
import {
  commandSchema,
  type Command,
  type OnlineGame,
} from "../../shared/protocol";

const cmd = (value: Omit<Command, "id">): Command => ({
  id: randomUUID(),
  ...value,
});
function setup(game: OnlineGame = "ladder", n = 3) {
  const room = newRoom("ABC234", 1000);
  const people = Array.from({ length: n }, (_, i) =>
    join(room, `session${i}`, `참가자${i}`, 1000),
  );
  applyCommand(
    room,
    room.hostId,
    cmd({
      type: "configure",
      game,
      config: { mode: "loser", count: 1, label: "꽝", good: false },
    }),
    1001,
  );
  people.forEach((p) =>
    applyCommand(room, p.id, cmd({ type: "ready", ready: true }), 1002),
  );
  applyCommand(room, room.hostId, cmd({ type: "prepare" }), 1003);
  begin(room, 1004);
  return room;
}
function act(room: Room, who: string, value: Partial<Command>, now = 5000) {
  return applyCommand(
    room,
    who,
    cmd({
      type: "act",
      roundId: room.gameState!.round.id,
      turn: room.gameState!.turn,
      ...value,
    }),
    now,
  );
}
describe("온라인 판정과 공개 정보", () => {
  it("비공개 배치·seed·세션을 전달하지 않는다", () => {
    for (const id of ["cards", "pirate", "bomb", "horse"] as OnlineGame[]) {
      const r = setup(id);
      const json = JSON.stringify(publicView(r, r.hostId, 5000));
      for (const hidden of [
        "session0",
        r.gameState!.round.seed,
        "explodeAt",
        '"bad"',
        '"ranking"',
        '"layout"',
        "tieOrder",
      ])
        expect(json).not.toContain(hidden);
    }
  });
  it("다른 차례 조작과 선택 중복을 거부한다", () => {
    const r = setup("cards"),
      g = r.gameState!;
    expect(() => act(r, r.members[1].id, { action: "pick", index: 0 })).toThrow(
      "차례",
    );
    act(r, current(g)!, { action: "pick", index: 0 });
    expect(() => act(r, current(g)!, { action: "pick", index: 0 })).toThrow(
      "카드",
    );
    expect(Object.keys(g.selected)).toHaveLength(1);
  });
  it("ACK 유실 후 동일 요청 재전송은 한번만 적용한다", () => {
    const r = setup("cards"),
      actor = current(r.gameState!)!;
    const c = cmd({
      type: "act",
      roundId: r.gameState!.round.id,
      turn: 0,
      action: "pick",
      index: 0,
    });
    expect(applyCommand(r, actor, c, 5000)).toBe(true);
    expect(applyCommand(r, actor, c, 5100)).toBe(false);
    expect(r.gameState!.turn).toBe(1);
  });
  it("옛 판·옛 차례·기한 이후 입력을 거절한다", () => {
    const r = setup("cards");
    expect(() =>
      act(r, r.hostId, { roundId: "old", action: "pick", index: 0 }),
    ).toThrow("판");
    expect(() =>
      act(r, r.hostId, { turn: 100, action: "pick", index: 0 }),
    ).toThrow("차례");
    expect(() =>
      act(r, r.hostId, { action: "pick", index: 0 }, r.gameState!.deadline),
    ).toThrow("시간");
  });
  it("설정 변경은 방장만, 진행 중에는 누구도 할 수 없다", () => {
    const r = setup();
    expect(() =>
      applyCommand(
        r,
        r.hostId,
        cmd({ type: "configure", game: "cards", config: { mode: "rank" } }),
        5000,
      ),
    ).toThrow();
    r.phase = "lobby";
    expect(() =>
      applyCommand(r, r.members[1].id, cmd({ type: "prepare" }), 5000),
    ).toThrow();
  });
  it.each([
    "ladder",
    "roulette",
    "cards",
    "pirate",
    "bomb",
    "scratch",
    "horse",
    "marble",
  ] as OnlineGame[])(
    "%s: 모두 이탈해도 제한 시간 규칙으로 동일한 결과를 완성한다",
    (game) => {
      const r = setup(game);
      let time = 5000,
        safety = 0;
      while (r.phase === "playing" && safety++ < 1000) {
        time = r.gameState!.deadline;
        tick(r, time);
      }
      expect(r.phase).toBe("result");
      expect(Object.keys(r.results!)).toHaveLength(3);
      expect(
        Object.values(r.results!).filter((x) => x.kind === "hit"),
      ).toHaveLength(1);
    },
  );
  it("재접속 신원은 유지되고, 60초 후 방장을 위임한다", () => {
    const r = setup();
    const old = r.hostId;
    disconnect(r, old, 5000);
    tick(r, 65001);
    expect(r.hostId).toBe(r.members[1].id);
    const m = join(r, "session0", "다른이름", 65002);
    expect(m.id).toBe(old);
    expect(r.hostId).not.toBe(old);
  });
  it("진행 중 입장자는 이번 판 조작을 할 수 없다", () => {
    const r = setup();
    const m = join(r, "late", "늦은사람", 5000);
    expect(m.spectator).toBe(true);
    expect(() => act(r, m.id, { action: "reveal" })).toThrow("다음 판");
  });
  it("시간 측정 재시작을 거절하고 미제출자는 정상 기록 뒤에 배치한다", () => {
    const r = setup("stopwatch");
    const first = r.members[0].id;
    act(r, first, { action: "watch-start" }, 5000);
    expect(() => act(r, first, { action: "watch-start" }, 6000)).toThrow(
      "이미 시작",
    );
    act(r, first, { action: "watch-stop", time: 10000 }, 15000);
    tick(r, r.gameState!.deadline);
    expect(r.phase).toBe("result");
    expect(r.results![first].kind).toBe("pass");
  });
  it("동점 재경기는 한 번만 허용한다", () => {
    const r = setup("stopwatch", 2);
    for (const p of r.members) act(r, p.id, { action: "watch-start" }, 5000);
    for (const p of r.members)
      act(r, p.id, { action: "watch-stop", time: 10000 }, 15000);
    expect(r.gameState!.watchStage).toBe(1);
    for (const p of r.members) act(r, p.id, { action: "watch-start" }, 16000);
    for (const p of r.members)
      act(r, p.id, { action: "watch-stop", time: 10000 }, 26000);
    expect(r.phase).toBe("result");
  });
  it("서버 입력 검증은 소수·음수·과도한 항목을 거절한다", () => {
    expect(
      commandSchema.safeParse(
        cmd({
          type: "configure",
          game: "cards",
          config: { mode: "loser", count: 1.5, label: "꽝", good: false },
        }),
      ).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({ ...cmd({ type: "act" }), index: -1 }).success,
    ).toBe(false);
  });
});
