import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { PROTOCOL, commandSchema } from "../shared/protocol";
import { FunctionRoomService } from "./service";

const nameSchema = z.string().trim().min(1).max(8);
const requestSchema = z
  .object({
    protocol: z.literal(PROTOCOL),
    tab: z.uuid(),
    name: nameSchema.optional(),
    command: commandSchema.optional(),
  })
  .strict();
export function createApi(
  service: FunctionRoomService,
  secret: string,
  production = false,
  origin?: string,
) {
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  const sign = (id: string) =>
    createHmac("sha256", secret).update(id).digest("base64url");
  function session(request: Request) {
    const value = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)game_guest_v2=([^;]+)/)?.[1];
    if (!value) return undefined;
    const [id, signature] = value.split(".");
    if (!/^[0-9a-f-]{36}$/.test(id) || !signature) return undefined;
    const expected = Buffer.from(sign(id)),
      actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
      return undefined;
    return { id, hash: createHash("sha256").update(id).digest("hex") };
  }
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    };
    const json = (
      data: unknown,
      status = 200,
      extra: Record<string, string> = {},
    ) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...headers, ...extra },
      });
    try {
      const path = new URL(request.url).pathname.replace(/\/$/, "");
      if (path === "/api/health" && request.method === "GET")
        return json({ ok: true, protocol: PROTOCOL, mode: "static-web-apps" });
      if (request.method === "POST") {
        if (
          request.headers.get("X-Game-Request") !== "1" ||
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return json({ error: "허용되지 않은 요청이에요." }, 403);
        const from = request.headers.get("origin");
        if (origin && from && from !== origin)
          return json({ error: "허용되지 않은 주소예요." }, 403);
        if (request.headers.get("sec-fetch-site") === "cross-site")
          return json({ error: "허용되지 않은 요청이에요." }, 403);
      }
      const guest = session(request);
      if (path === "/api/session" && request.method === "GET") {
        const id = guest?.id ?? randomUUID();
        return json({ protocol: PROTOCOL }, 200, {
          "Set-Cookie": `game_guest_v2=${id}.${sign(id)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=86400${production ? "; Secure" : ""}`,
        });
      }
      if (!guest)
        return json(
          { error: "세션이 만료되었어요. 새로고침 후 입장해 주세요." },
          401,
        );
      const readBody = async () => {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 16384)
          throw new Error("요청이 너무 커요.");
        return JSON.parse(raw);
      };
      if (path === "/api/rooms" && request.method === "POST") {
        const body = z
          .object({ name: nameSchema, id: z.uuid() })
          .strict()
          .parse(await readBody());
        const room = await service.create(guest.hash, body.name, body.id);
        return json({ code: room.code }, 201);
      }
      const match = path.match(
        /^\/api\/rooms\/([A-Z2-9]{6})\/(join|sync|command|takeover|negotiate|history)$/,
      );
      if (!match) return json({ error: "없는 주소예요." }, 404);
      const [, code, operation] = match;
      if (operation === "history" && request.method === "GET") {
        const { room, member } = await service.member(code, guest.hash);
        return json(
          room.completed.filter(
            (h) =>
              h.createdAt > service.now() - 86400000 &&
              h.participants.some((p) => p.id === member.id),
          ),
        );
      }
      if (request.method !== "POST")
        return json({ error: "허용되지 않은 요청이에요." }, 405);
      const body = requestSchema.parse(await readBody());
      if (operation === "negotiate") {
        const { room, member } = await service.member(code, guest.hash);
        return json({
          url: await service.notifications.negotiate(room.id, member.id),
        });
      }
      if (operation === "join") {
        nameSchema.parse(body.name);
        await service.limit("join-" + guest.hash, 30, 60000);
      }
      if (operation === "command") commandSchema.parse(body.command);
      if (operation === "command" && body.command?.type === "leave") {
        await service.leave(code, guest.hash, body.tab, body.command);
        return json({ ok: true, left: true });
      }
      const result = await service.operate(
        code,
        guest.hash,
        body.tab,
        operation as "join" | "sync" | "command" | "takeover",
        operation === "join" ? body.name : body.command,
      );
      return json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof z.ZodError || e instanceof SyntaxError)
        return json(
          {
            error:
              "입력값 또는 앱 버전을 확인해 주세요. 새로고침 후 다시 시도해 주세요.",
          },
          400,
        );
      // SDK errors can include account URLs and headers. Never return them to clients.
      const message = (e as Error).message;
      return /[가-힣]/.test(message)
        ? json({ error: message }, 409)
        : json(
            {
              error: "서버에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
            },
            503,
          );
    }
  };
}
