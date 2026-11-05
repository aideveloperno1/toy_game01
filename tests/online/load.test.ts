import { expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FileStore } from "../../server/storage";
import { RoomService } from "../../server/service";
import { createApp } from "../../server/http";

it.each([
  { rooms: 1, people: 30 },
  { rooms: 10, people: 10 },
])(
  "파일 저장을 포함한 $rooms개 방 × $people명 동시 접속",
  async ({ rooms, people }) => {
    const root = await mkdtemp(join(tmpdir(), "room-load-")),
      svc = new RoomService(new FileStore(root));
    const server = createApp(svc, "test-load-secret-at-least-32-characters"),
      sockets: Socket[] = [];
    await new Promise<void>((r) => server.http.listen(0, "127.0.0.1", r));
    const address = server.http.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      const groups: Socket[][] = [];
      for (let j = 0; j < rooms; j++) {
        const group: Socket[] = [];
        let code = "";
        for (let i = 0; i < people; i++) {
          const cookie = (await fetch(`${url}/api/session`)).headers
            .get("set-cookie")!
            .split(";")[0];
          if (i === 0) {
            const res = await fetch(`${url}/api/rooms`, {
              method: "POST",
              headers: { Cookie: cookie, "Content-Type": "application/json" },
              body: JSON.stringify({ name: `사람${i}` }),
            });
            code = (await res.json()).code;
            expect(code).toBeTruthy();
          }
          const socket = io(url, {
            transports: ["websocket"],
            extraHeaders: { Cookie: cookie },
            reconnection: false,
            autoConnect: false,
          });
          sockets.push(socket);
          await new Promise<void>((r, reject) => {
            socket.once("connect", r);
            socket.once("connect_error", reject);
            socket.connect();
          });
          expect(
            (
              await socket
                .timeout(5000)
                .emitWithAck("join", { code, name: `사람${i}`, protocol: 1 })
            ).ok,
          ).toBe(true);
          group.push(socket);
        }
        groups.push(group);
      }
      const latencies: number[] = [];
      await Promise.all(
        groups.flat().map(async (socket) => {
          const t = performance.now();
          const ack = await socket
            .timeout(5000)
            .emitWithAck("command", {
              id: randomUUID(),
              type: "ready",
              ready: true,
            });
          expect(ack.ok).toBe(true);
          latencies.push(performance.now() - t);
        }),
      );
      latencies.sort((a, b) => a - b);
      const p95 = Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]);
      expect(
        [...svc.rooms.values()].every(
          (r) => r.members.length === people && r.members.every((m) => m.ready),
        ),
      ).toBe(true);
      await mkdir(".data", { recursive: true });
      await writeFile(
        `.data/load-${rooms}x${people}.json`,
        JSON.stringify(
          {
            rooms,
            people,
            connections: rooms * people,
            p95ms: p95,
            maxMs: Math.round(latencies.at(-1)!),
            storage: "atomic local files",
            environment: "local loopback; not Azure",
          },
          null,
          2,
        ),
      );
      console.log(`LOAD ${rooms}x${people}: p95=${p95}ms`);
      expect(p95).toBeLessThan(500);
    } finally {
      sockets.forEach((s) => s.disconnect());
      await server.close();
      // Test-owned mkdtemp directory only.
      if (
        resolve(root).startsWith(resolve(tmpdir()) + "\\") ||
        resolve(root).startsWith(resolve(tmpdir()) + "/")
      )
        await rm(root, { recursive: true, force: true });
    }
  },
);
