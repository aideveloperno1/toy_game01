import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../../server/storage";
import { RoomService } from "../../server/service";
import { createApp } from "../../server/http";
import {
  PROTOCOL,
  type Ack,
  type Command,
  type RoomView,
} from "../../shared/protocol";

let svc: RoomService, server: ReturnType<typeof createApp>, base: string;
const sockets: Socket[] = [];
async function guest() {
  const res = await fetch(`${base}/api/session`);
  return res.headers.get("set-cookie")!.split(";")[0];
}
async function create(cookie: string, name = "방장") {
  const res = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).code as string;
}
async function client(cookie: string, code: string, name: string) {
  const socket = io(base, {
    extraHeaders: { Cookie: cookie },
    transports: ["websocket"],
    reconnection: false,
    autoConnect: false,
  });
  sockets.push(socket);
  const states: RoomView[] = [];
  socket.on("state", (r: RoomView) => states.push(r));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
  const ack = (await socket
    .timeout(3000)
    .emitWithAck("join", { code, name, protocol: PROTOCOL })) as Ack;
  expect(ack.ok).toBe(true);
  return {
    socket,
    states,
    get room() {
      return states.at(-1)!;
    },
  };
}
async function send(socket: Socket, c: Omit<Command, "id"> & { id?: string }) {
  return (await socket
    .timeout(3000)
    .emitWithAck("command", { id: randomUUID(), ...c })) as Ack;
}
beforeEach(async () => {
  svc = new RoomService(new MemoryStore());
  server = createApp(svc, "test-secret-at-least-32-characters", {
    adminToken: "test-admin-token-not-a-real-secret",
  });
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", resolve),
  );
  const addr = server.http.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await server.close();
});
describe("실제 HTTP / Socket.IO 연결", () => {
  it("점검 모드는 인증된 운영 요청만 허용하며 새 방을 막는다", async () => {
    const denied = await fetch(`${base}/api/admin/status`);
    expect(denied.status).toBe(404);
    const headers = {
      Authorization: "Bearer test-admin-token-not-a-real-secret",
      "Content-Type": "application/json",
    };
    const drain = await fetch(`${base}/api/admin/drain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    expect(drain.status).toBe(200);
    const cookie = await guest();
    const response = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "가" }),
    });
    expect(response.status).toBe(400);
    await fetch(`${base}/api/admin/drain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: false }),
    });
    expect(await create(cookie)).toBeTruthy();
  });
  it("세션은 HttpOnly이고 외부 Origin의 변경 요청을 거절한다", async () => {
    const res = await fetch(`${base}/api/session`);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
    const denied = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: {
        Origin: "https://other.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(denied.status).toBe(403);
  });
  it("3명이 참가해 재접속·중복 탭·다른 방 격리를 확인한다", async () => {
    const [a, b, c, d] = await Promise.all([
      guest(),
      guest(),
      guest(),
      guest(),
    ]);
    const code = await create(a),
      other = await create(d);
    const host = await client(a, code, "방장"),
      p2 = await client(b, code, "친구"),
      p3 = await client(c, code, "친구"),
      isolated = await client(d, other, "다른방");
    expect(host.room.members).toHaveLength(3);
    expect(p3.room.members.map((m) => m.name)).toContain("친구(2)");
    expect(isolated.room.members).toHaveLength(1);
    const tab = await client(b, code, "친구");
    expect(tab.room.control).toBe(false);
    expect((await send(tab.socket, { type: "ready", ready: true })).ok).toBe(
      false,
    );
    await tab.socket.timeout(3000).emitWithAck("takeover");
    expect(tab.room.control).toBe(true);
    expect(p2.room.control).toBe(false);
    expect((await send(p3.socket, { type: "prepare" })).ok).toBe(false);
    const identity = tab.room.self;
    tab.socket.disconnect();
    p2.socket.disconnect();
    const returned = await client(b, code, "별명변경");
    expect(returned.room.self).toBe(identity);
    expect(returned.room.members).toHaveLength(3);
    const response = await fetch(`${base}/api/rooms/${code}/history`, {
      headers: { Cookie: d },
    });
    expect(response.status).toBe(403);
  });
  it("게임 시작과 입력은 서버가 판정하고 ACK 유실 재전송을 중복 적용하지 않는다", async () => {
    const a = await guest(),
      b = await guest(),
      code = await create(a);
    const host = await client(a, code, "가"),
      friend = await client(b, code, "나");
    await send(host.socket, {
      type: "configure",
      game: "cards",
      config: { mode: "rank" },
    });
    await send(host.socket, { type: "ready", ready: true });
    await send(friend.socket, { type: "ready", ready: true });
    expect((await send(host.socket, { type: "prepare" })).ok).toBe(true);
    const id = host.room.gameState!.id;
    await send(host.socket, { type: "loaded", roundId: id });
    await send(friend.socket, { type: "loaded", roundId: id });
    expect(host.room.phase).toBe("playing");
    const r = svc.get(code);
    r.gameState!.startAt = Date.now() - 100;
    const command = {
      id: randomUUID(),
      type: "act" as const,
      action: "pick" as const,
      index: 0,
      turn: 0,
      roundId: id,
    };
    expect((await send(friend.socket, command)).ok).toBe(false);
    expect((await send(host.socket, command)).ok).toBe(true);
    expect((await send(host.socket, command)).ok).toBe(true);
    expect(svc.get(code).gameState!.turn).toBe(1);
    expect(
      (
        await send(friend.socket, {
          type: "act",
          action: "pick",
          index: 1,
          turn: 1,
          roundId: id,
        })
      ).ok,
    ).toBe(true);
    expect(host.room.results).toEqual(friend.room.results);
    expect(host.room.phase).toBe("result");
    const history = await (
      await fetch(`${base}/api/rooms/${code}/history`, {
        headers: { Cookie: a },
      })
    ).json();
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain(r.gameState!.round.seed);
  });
});
