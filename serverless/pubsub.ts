import { WebPubSubServiceClient } from "@azure/web-pubsub";
import type { Notifications } from "./service";
export class AzureNotifications implements Notifications {
  private client;
  constructor(connection: string) {
    this.client = new WebPubSubServiceClient(connection, "game", {
      retryOptions: { maxRetries: 0 },
    });
  }
  async changed(roomId: string, revision: number) {
    await this.client
      .group("room-" + roomId)
      .sendToAll({ revision }, { abortSignal: AbortSignal.timeout(2000) });
  }
  async negotiate(roomId: string, memberId: string) {
    const token = await this.client.getClientAccessToken({
      userId: memberId,
      groups: ["room-" + roomId],
      roles: [],
      expirationTimeInMinutes: 5,
    });
    return token.url;
  }
}
