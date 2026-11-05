import { app } from "@azure/functions";
import { createApi } from "./api";
import { BlobRepository } from "./repository";
import { FunctionRoomService } from "./service";
import { AzureNotifications } from "./pubsub";

let handler: ReturnType<typeof createApi> | undefined;
app.http("game", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (request) => {
    const {
      GAME_STORAGE_CONNECTION_STRING,
      WEB_PUBSUB_CONNECTION_STRING,
      SESSION_SECRET,
      APP_ORIGIN,
    } = process.env;
    if (
      !GAME_STORAGE_CONNECTION_STRING ||
      !WEB_PUBSUB_CONNECTION_STRING ||
      !SESSION_SECRET ||
      SESSION_SECRET.length < 32
    )
      return {
        status: 503,
        headers: { "Cache-Control": "no-store" },
        jsonBody: {
          error: "온라인 서비스 설정이 필요해요. 관리자에게 알려 주세요.",
        },
      };
    handler ??= createApi(
      new FunctionRoomService(
        new BlobRepository(GAME_STORAGE_CONNECTION_STRING),
        new AzureNotifications(WEB_PUBSUB_CONNECTION_STRING),
      ),
      SESSION_SECRET,
      true,
      APP_ORIGIN,
    );
    const response = await handler(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.method === "POST" ? await request.text() : undefined,
      }),
    );
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  },
});
