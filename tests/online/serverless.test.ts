import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApi } from "../../serverless/api";
import {
  FunctionRoomService,
  noNotifications,
  type StoredRoom,
} from "../../serverless/service";
import { MemoryRepository, BlobRepository } from "../../serverless/repository";
import { AzureNotifications } from "../../serverless/pubsub";
import { PROTOCOL, type Command } from "../../shared/protocol";

const secret = "test-only-session-secret-at-least-32-characters";
const command = (value: Omit<Command, "id">) => ({
  id: randomUUID(),
  ...value,
});
async function setup(n = 3) {
  const store = new MemoryRepository();
  let now = 100000;
  const service = new FunctionRoomService(store, noNotifications, () => now);
  const room = await service.create("s0", "사람0", randomUUID());
  const tabs = Array.from({ length: n }, () => randomUUID());
  for (let i = 0; i < n; i++)
    await service.operate(room.code, "s" + i, tabs[i], "join", "사람" + i);
  const op = (i: number, value: Omit<Command, "id">) =>
    service.operate(room.code, "s" + i, tabs[i], "command", command(value));
  const start = async () => {
    for (let i = 0; i < n; i++) await op(i, { type: "ready", ready: true });
    const prepared = await op(0, { type: "prepare" });
    for (let i = 0; i < n; i++)
      await op(i, { type: "loaded", roundId: prepared.room.gameState!.id });
    now += 3500;
    return (await service.operate(room.code, "s0", tabs[0], "sync")).room;
  };
  return {
    store,
    service,
    code: room.code,
    tabs,
    op,
    start,
    advance: (ms: number) => (now += ms),
    clock: () => now,
  };
}
describe("SWA의 저장 기반 방 처리", () => {
  it("30명의 동시 준비를 여러 함수 인스턴스가 처리해도 유실되지 않는다", async () => {
    const t = await setup(30);
    await t.op(0, {
      type: "configure",
      game: "marble",
      config: { mode: "rank" },
    });
    await Promise.all(
      t.tabs.map((tab, i) =>
        new FunctionRoomService(t.store, noNotifications, t.clock).operate(
          t.code,
          "s" + i,
          tab,
          "command",
          command({ type: "ready", ready: true }),
        ),
      ),
    );
    const result = await t.service.operate(t.code, "s0", t.tabs[0], "sync");
    expect(result.room.members.filter((m) => m.ready)).toHaveLength(30);
    expect(result.room.members).toHaveLength(30);
  });
  it("콜드 스타트 후 진행 판과 참가자를 유지하고 동일 요청은 한 번만 반영한다", async () => {
    const t = await setup();
    const playing = await t.start();
    const next = new FunctionRoomService(t.store, noNotifications, t.clock);
    const restored = await next.operate(t.code, "s0", t.tabs[0], "sync");
    expect(restored.room.phase).toBe("playing");
    expect(restored.room.self).toBe(playing.self);
    const cmd = command({
      type: "act",
      roundId: playing.gameState!.id,
      turn: 0,
      action: "reveal",
    });
    await Promise.all(
      [t.service, next].map((s) =>
        s.operate(t.code, "s0", t.tabs[0], "command", cmd),
      ),
    );
    const room = (await next.operate(t.code, "s0", t.tabs[0], "sync")).room;
    expect(Object.keys(room.gameState!.revealed)).toHaveLength(1);
  });
  it("저장 실패나 알림 실패로 결과를 미리 확정하거나 되돌리지 않는다", async () => {
    const t = await setup();
    const savedPut = t.store.put.bind(t.store);
    t.store.put = async () => {
      throw new Error("offline");
    };
    await expect(t.op(0, { type: "ready", ready: true })).rejects.toThrow(
      "offline",
    );
    t.store.put = savedPut;
    expect(
      (await t.service.operate(t.code, "s0", t.tabs[0], "sync")).room.members[0]
        .ready,
    ).toBe(false);
    const failing = new FunctionRoomService(
      t.store,
      {
        ...noNotifications,
        changed: async () => {
          throw new Error("offline");
        },
      },
      t.clock,
    );
    await failing.operate(
      t.code,
      "s0",
      t.tabs[0],
      "command",
      command({ type: "ready", ready: true }),
    );
    expect(
      (await t.service.operate(t.code, "s0", t.tabs[0], "sync")).room.members[0]
        .ready,
    ).toBe(true);
  });
  it("마감 이후 첫 요청이 자동 결과를 만들고 다른 함수에서도 같은 결과를 읽는다", async () => {
    const t = await setup();
    await t.start();
    t.advance(45000);
    const a = await t.service.operate(t.code, "s0", t.tabs[0], "sync");
    const b = await new FunctionRoomService(
      t.store,
      noNotifications,
      t.clock,
    ).operate(t.code, "s1", t.tabs[1], "sync");
    expect(a.room.phase).toBe("result");
    expect(b.room.results).toEqual(a.room.results);
    const stored = await t.store.get<StoredRoom>("rooms/" + t.code);
    expect(stored!.value.completed).toHaveLength(1);
  });
  it("연결 끊긴 방장을 위임하고 10분간 전원 부재한 방은 닫는다", async () => {
    const t = await setup(2);
    for (let i = 0; i < 18; i++) {
      t.advance(5000);
      await t.service.operate(t.code, "s1", t.tabs[1], "sync");
    }
    const room = (await t.service.operate(t.code, "s1", t.tabs[1], "sync"))
      .room;
    expect(room.hostId).toBe(room.self);
    t.advance(650000);
    expect(
      (await t.service.operate(t.code, "s1", t.tabs[1], "sync")).room.phase,
    ).toBe("closed");
  });
  it("별도 탭은 읽기 전용이고 명시적으로 인수한 탭만 조작한다", async () => {
    const t = await setup(2),
      second = randomUUID();
    expect(
      (await t.service.operate(t.code, "s0", second, "join", "사람0")).room
        .control,
    ).toBe(false);
    await expect(
      t.service.operate(
        t.code,
        "s0",
        second,
        "command",
        command({ type: "ready", ready: true }),
      ),
    ).rejects.toThrow("다른 창");
    expect(
      (await t.service.operate(t.code, "s0", second, "takeover")).room.control,
    ).toBe(true);
    await expect(t.op(0, { type: "ready", ready: true })).rejects.toThrow(
      "다른 창",
    );
  });
  it("미참가자는 상태를 볼 수 없고 공개 상태에 정답과 인증 정보가 없다", async () => {
    const t = await setup();
    await t.start();
    await expect(
      t.service.operate(t.code, "outsider", randomUUID(), "sync"),
    ).rejects.toThrow("입장");
    const result = await t.service.operate(t.code, "s0", t.tabs[0], "sync");
    for (const key of [
      "creationKey",
      "session",
      "presence",
      "ranking",
      "seed",
      "layout",
      "tieOrder",
    ])
      expect(JSON.stringify(result)).not.toContain('"' + key + '"');
  });
  it("응답이 유실된 방 생성 요청을 재시도해도 같은 방을 반환한다", async () => {
    const t = await setup();
    const id = randomUUID();
    const rooms = await Promise.all(
      [0, 1, 2].map(() =>
        new FunctionRoomService(t.store, noNotifications, t.clock).create(
          "new",
          "새사람",
          id,
        ),
      ),
    );
    expect(new Set(rooms.map((r) => r.id)).size).toBe(1);
  });
});
describe("실제 HTTP 경계", () => {
  const make = () =>
    createApi(new FunctionRoomService(new MemoryRepository()), secret, true);
  const req = (
    path: string,
    body?: unknown,
    cookie?: string,
    extra: Record<string, string> = {},
  ) =>
    new Request("https://example.azurestaticapps.net/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Game-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  it("인증 쿠키와 요청 출처 검증, 새로고침, 히스토리 권한을 적용한다", async () => {
    const api = make();
    const session = await api(req("session"));
    const header = session.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    const cookie = header.split(";")[0];
    expect(
      (await api(req("rooms", { name: "나", id: randomUUID() }))).status,
    ).toBe(401);
    expect(
      (
        await api(
          req("rooms", { name: "나", id: randomUUID() }, cookie, {
            "X-Game-Request": "",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          req("rooms", { name: "나", id: randomUUID() }, cookie, {
            "sec-fetch-site": "cross-site",
          }),
        )
      ).status,
    ).toBe(403);
    const created = await api(
      req("rooms", { name: "나", id: randomUUID() }, cookie),
    );
    expect(created.status).toBe(201);
    const { code } = await created.json();
    const tab = randomUUID();
    const joined = await (
      await api(
        req(
          "rooms/" + code + "/join",
          { protocol: PROTOCOL, tab, name: "나" },
          cookie,
        ),
      )
    ).json();
    const restored = await (
      await api(
        req("rooms/" + code + "/sync", { protocol: PROTOCOL, tab }, cookie),
      )
    ).json();
    expect(restored.room.self).toBe(joined.room.self);
    expect(
      (await api(req("rooms/" + code + "/history", undefined, cookie))).status,
    ).toBe(200);
    const stranger = (await api(req("session"))).headers
      .get("set-cookie")!
      .split(";")[0];
    expect(
      (await api(req("rooms/" + code + "/history", undefined, stranger)))
        .status,
    ).toBe(409);
    expect(
      (
        await api(
          req(
            "rooms/" + code + "/negotiate",
            { protocol: PROTOCOL, tab },
            stranger,
          ),
        )
      ).status,
    ).toBe(409);
    expect(
      (await api(req("rooms/" + code + "/sync", { protocol: 0, tab }, cookie)))
        .status,
    ).toBe(400);
    const leave = {
      protocol: PROTOCOL,
      tab,
      command: command({ type: "leave" }),
    };
    const departures = await Promise.all(
      [0, 1].map(() => api(req("rooms/" + code + "/command", leave, cookie))),
    );
    for (const response of departures) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, left: true });
    }
  });
  it("위조 쿠키를 거부하고 개인 상태를 캐시하지 않는다", async () => {
    const api = make();
    const r = await api(
      req(
        "rooms",
        { name: "나", id: randomUUID() },
        "game_guest_v2=" + randomUUID() + ".forged",
      ),
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("Web PubSub 토큰은 한 방에만 들어가며 전송/그룹 변경 권한이 없다", async () => {
    const key = Buffer.from(
      Array.from({ length: 32 }, (_, i) => i + 1),
    ).toString("base64");
    const notifier = new AzureNotifications(
      `Endpoint=https://unit-test.webpubsub.azure.com;AccessKey=${key};Version=1.0;`,
    );
    const url = new URL(await notifier.negotiate("room-id", "member-id"));
    const token = url.searchParams.get("access_token")!;
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    expect(payload.sub).toBe("member-id");
    expect(payload["webpubsub.group"]).toEqual(["room-room-id"]);
    expect(payload.role ?? []).toEqual([]);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(301);
  });
});
it.skipIf(process.env.TEST_AZURITE !== "1")(
  "Azure Blob 실제 조건부 저장: 충돌, 한글, 별도 함수의 동시 요청과 복구",
  async () => {
    const key = Buffer.from(
      Array.from({ length: 32 }, (_, i) => i + 1),
    ).toString("base64");
    const connection = `DefaultEndpointsProtocol=http;AccountName=gametest;AccountKey=${key};BlobEndpoint=http://127.0.0.1:11000/gametest;`;
    const container = "swa-test-" + randomUUID();
    const a = new BlobRepository(connection, container),
      b = new BlobRepository(connection, container);
    const value = { label: "한글과 이모지 🎲".repeat(20000) };
    expect(await a.put("text", value, null)).toBe(true);
    const snapshot = (await b.get<typeof value>("text"))!;
    expect(snapshot.value).toEqual(value);
    expect(await a.put("text", { label: "new" }, snapshot.etag)).toBe(true);
    expect(await b.put("text", value, snapshot.etag)).toBe(false);
    const s1 = new FunctionRoomService(a),
      s2 = new FunctionRoomService(b);
    const room = await s1.create("a", "방장", randomUUID());
    const tabs = Array.from({ length: 10 }, () => randomUUID());
    await Promise.all(
      tabs.map((tab, i) =>
        (i % 2 ? s1 : s2).operate(room.code, "s" + i, tab, "join", "사람" + i),
      ),
    );
    await Promise.all(
      tabs.map((tab, i) =>
        (i % 2 ? s1 : s2).operate(
          room.code,
          "s" + i,
          tab,
          "command",
          command({ type: "ready", ready: true }),
        ),
      ),
    );
    const restored = (
      await new FunctionRoomService(
        new BlobRepository(connection, container),
      ).operate(room.code, "s0", tabs[0], "sync")
    ).room;
    expect(restored.members).toHaveLength(11);
    expect(restored.members.filter((m) => m.ready)).toHaveLength(10);
  },
);
