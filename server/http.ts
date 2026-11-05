import express from "express";
import { createServer } from "node:http";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { z } from "zod";
import {
  commandSchema,
  joinSchema,
  PROTOCOL,
  type Ack,
} from "../shared/protocol";
import { RoomService } from "./service";
import { check } from "./engine";

export function createApp(
  service: RoomService,
  secret: string,
  options: {
    origin?: string;
    production?: boolean;
    dist?: string;
    maintenance?: boolean;
    adminToken?: string;
  } = {},
) {
  const app = express();
  const http = createServer(app);
  if (options.production) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  const rates = new Map<string, { count: number; until: number }>();
  let maintenance = !!options.maintenance;
  function limit(key: string, max: number, window = 60000) {
    const now = Date.now();
    let entry = rates.get(key);
    if (!entry || entry.until < now) {
      entry = { count: 0, until: now + window };
      rates.set(key, entry);
    }
    check(++entry.count <= max, "요청이 너무 많아요. 잠시 기다려 주세요.");
  }
  function allowed(origin: string | undefined, host: string | undefined) {
    if (!origin) return true;
    if (options.origin) return origin === options.origin;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const signature = (id: string) =>
    createHmac("sha256", secret).update(id).digest("hex");
  function parseCookie(cookie = ""): string | undefined {
    const token = cookie
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("game_guest="))
      ?.slice(11);
    if (!token) return;
    const [id, sig] = token.split(".");
    if (!id || !sig || sig.length !== 64 || !/^[a-f0-9]{64}$/.test(sig)) return;
    if (
      !timingSafeEqual(
        Buffer.from(sig, "hex"),
        Buffer.from(signature(id), "hex"),
      )
    )
      return;
    return createHash("sha256").update(id).digest("hex");
  }
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store");
      if (!allowed(req.headers.origin, req.headers.host)) {
        res.status(403).json({ error: "허용되지 않은 접속 주소예요." });
        return;
      }
    }
    next();
  });
  app.get("/health", (_req, res) => res.json({ ok: true, protocol: PROTOCOL }));
  app.get("/api/session", (req, res) => {
    if (!parseCookie(req.headers.cookie)) {
      const id = randomUUID();
      res.cookie("game_guest", `${id}.${signature(id)}`, {
        httpOnly: true,
        secure: !!options.production,
        sameSite: "lax",
        maxAge: 86400000,
        path: "/",
      });
    }
    res.json({ protocol: PROTOCOL, maintenance });
  });
  app.post("/api/rooms", async (req, res) => {
    try {
      check(!maintenance, "점검 중에는 새 방을 만들 수 없어요.");
      limit(`create:${req.ip}`, 30);
      const session = parseCookie(req.headers.cookie);
      check(session, "화면을 새로고침해 주세요.");
      limit(`create-session:${session}`, 6);
      const { name } = z
        .object({ name: z.string().trim().min(1).max(8) })
        .strict()
        .parse(req.body);
      const room = await service.create(session, name);
      res.status(201).json({ code: room.code });
    } catch (e) {
      res.status(400).json({ error: safeError(e) });
    }
  });
  app.use("/api/admin", (req, res, next) => {
    const provided = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const expected = options.adminToken;
    if (
      !expected ||
      Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      res.sendStatus(404);
      return;
    }
    next();
  });
  const activeRounds = () =>
    [...service.rooms.values()].filter(
      (r) => r.phase === "playing" || r.phase === "preparing",
    ).length;
  app.get("/api/admin/status", (_req, res) =>
    res.json({ maintenance, activeRounds: activeRounds() }),
  );
  app.post("/api/admin/drain", (req, res) => {
    const body = z
      .object({ enabled: z.boolean() })
      .strict()
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "입력을 확인해 주세요." });
      return;
    }
    maintenance = body.data.enabled;
    res.json({ maintenance, activeRounds: activeRounds() });
  });
  app.get("/api/rooms/:code/history", (req, res) => {
    try {
      const session = parseCookie(req.headers.cookie);
      check(session, "다시 입장해 주세요.");
      const room = service.get(String(req.params.code));
      const member = room.members.find((m) => m.session === session);
      check(member, "이 방의 참가자만 기록을 볼 수 있어요.");
      res.json(
        room.completed.filter(
          (h) =>
            h.createdAt > Date.now() - 86400000 &&
            h.participants.some((p) => p.id === member.id),
        ),
      );
    } catch (e) {
      res.status(403).json({ error: safeError(e) });
    }
  });
  const io = new Server(http, {
    maxHttpBufferSize: 16384,
    allowRequest: (req, cb) =>
      cb(null, allowed(req.headers.origin, req.headers.host)),
  });
  // Controller ownership is ephemeral; it is never trusted as participant identity.
  const controllers = new Map<string, string>();
  const key = (code: string, id: string) => `${code}:${id}`;
  service.onChange = (room) => {
    for (const socket of io.sockets.sockets.values())
      if (socket.data.code === room.code) {
        socket.emit(
          "state",
          service.view(
            room.code,
            socket.data.member,
            controllers.get(key(room.code, socket.data.member)) === socket.id,
          ),
        );
      }
  };
  io.use((socket, next) => {
    const session = parseCookie(socket.handshake.headers.cookie);
    if (!session) return next(new Error("새로고침 후 다시 연결해 주세요."));
    socket.data.session = session;
    next();
  });
  io.on("connection", (socket) => {
    socket.on(
      "join",
      async (raw: unknown, reply: (a: Ack) => void = () => {}) => {
        if (typeof reply !== "function") reply = () => {};
        try {
          check(!socket.data.code, "이미 입장한 연결이에요.");
          limit(`join:${socket.handshake.address}`, 120);
          limit(`join:${socket.data.session}`, 30);
          const { code, name } = joinSchema.parse(raw);
          const member = await service.connect(code, socket.data.session, name);
          socket.data.code = code;
          socket.data.member = member;
          const controlKey = key(code, member);
          if (!controllers.has(controlKey))
            controllers.set(controlKey, socket.id);
          await socket.join(code);
          service.onChange(service.get(code));
          reply({ ok: true });
        } catch (e) {
          reply({ ok: false, error: safeError(e) });
        }
      },
    );
    socket.on("takeover", (reply: (a: Ack) => void = () => {}) => {
      if (typeof reply !== "function") reply = () => {};
      try {
        check(socket.data.code, "먼저 입장해 주세요.");
        limit(`control:${socket.data.session}`, 10);
        controllers.set(key(socket.data.code, socket.data.member), socket.id);
        service.onChange(service.get(socket.data.code));
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, error: safeError(e) });
      }
    });
    socket.on(
      "command",
      async (raw: unknown, reply: (a: Ack) => void = () => {}) => {
        if (typeof reply !== "function") reply = () => {};
        try {
          limit(`action:${socket.data.session}`, 30, 1000);
          const { code, member } = socket.data;
          check(
            code && controllers.get(key(code, member)) === socket.id,
            "이 화면의 조작권을 먼저 가져와 주세요.",
          );
          const command = commandSchema.parse(raw);
          check(
            !(maintenance && command.type === "prepare"),
            "점검 중에는 새 판을 시작할 수 없어요.",
          );
          await service.command(code, member, command);
          reply({ ok: true });
          if (command.type === "leave") {
            for (const peer of io.sockets.sockets.values())
              if (peer.data.code === code && peer.data.member === member) {
                peer.emit("left");
                peer.disconnect(true);
              }
            controllers.delete(key(code, member));
          }
        } catch (e) {
          reply({ ok: false, error: safeError(e) });
        }
      },
    );
    socket.on("sync", () => {
      try {
        limit(`sync:${socket.data.session}`, 15);
        if (socket.data.code) service.onChange(service.get(socket.data.code));
      } catch {
        /* ignore excessive sync requests */
      }
    });
    socket.on("disconnect", () => {
      const { code, member } = socket.data;
      if (!code) return;
      const peers = [...io.sockets.sockets.values()].filter(
        (s) => s.data.code === code && s.data.member === member,
      );
      if (controllers.get(key(code, member)) === socket.id) {
        if (peers.length) controllers.set(key(code, member), peers[0].id);
        else controllers.delete(key(code, member));
      }
      if (!peers.length)
        void service
          .disconnect(code, member)
          .catch(() => console.error("room_disconnect_save_failed"));
      else service.onChange(service.get(code));
    });
  });
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void service
      .sweep()
      .catch(() => {
        io.emit(
          "service-error",
          "저장소 연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
        );
        console.error("room_sweep_failed");
      })
      .finally(() => {
        ticking = false;
      });
    for (const code of service.rooms.keys()) {
      const sample = service.raceFrame(code);
      if (sample) io.to(code).volatile.emit("race-frame", sample);
    }
    for (const [id, entry] of rates)
      if (entry.until < Date.now()) rates.delete(id);
  }, 150);
  timer.unref();
  const dist = options.dist ?? resolve("dist");
  app.use(
    express.static(dist, {
      setHeaders: (res, file) => {
        if (file.endsWith("sw.js") || file.endsWith("index.html"))
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/"))
      res.status(404).json({ error: "없는 주소예요." });
    else res.sendFile(resolve(dist, "index.html"));
  });
  return {
    app,
    http,
    io,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
      await service.drain();
    },
  };
}
function safeError(e: unknown) {
  return e instanceof z.ZodError
    ? "입력 형식을 확인해 주세요."
    : e instanceof Error && /[가-힣]/.test(e.message)
      ? e.message
      : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
