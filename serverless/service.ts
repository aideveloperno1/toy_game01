import { createHash, randomInt } from "node:crypto";
import {
  applyCommand,
  begin,
  check,
  disconnect,
  join,
  newRoom,
  publicView,
  tick,
  type Room,
  type Game,
} from "../server/engine";
import { buildRace, frame, type RaceAsset } from "../server/races";
import type { Command } from "../shared/protocol";
import type { Repository } from "./repository";

type Presence = { seen: number; tab: string; controlSeen: number };
export type StoredRoom = Room & {
  presence: Record<string, Presence>;
  creationKey: string;
};
export interface Notifications {
  changed(roomId: string, revision: number): Promise<void>;
  negotiate(roomId: string, memberId: string): Promise<string | null>;
}
export const noNotifications: Notifications = {
  changed: async () => {},
  negotiate: async () => null,
};
export class FunctionRoomService {
  // Immutable animations may be cached; room state is always read from storage.
  private assets = new Map<string, { value: RaceAsset; at: number }>();
  private loading = new Map<string, Promise<RaceAsset>>();
  constructor(
    readonly store: Repository,
    readonly notifications = noNotifications,
    readonly now = Date.now,
  ) {}
  private async raceAsset(game: Game): Promise<RaceAsset> {
    const id = game.round.id;
    for (const [key, cached] of this.assets)
      if (Date.now() - cached.at > 120000) this.assets.delete(key);
    const cached = this.assets.get(id);
    if (cached) {
      cached.at = Date.now();
      return cached.value;
    }
    let loading = this.loading.get(id);
    if (!loading) {
      loading = (async () => {
        let asset = (await this.store.get<RaceAsset>("races/" + id))?.value;
        if (!asset) {
          asset = await buildRace(game);
          await this.store.put("races/" + id, asset, null);
        }
        if (this.assets.size >= 8)
          this.assets.delete(this.assets.keys().next().value!);
        this.assets.set(id, { value: asset, at: Date.now() });
        return asset;
      })();
      this.loading.set(id, loading);
    }
    try {
      return await loading;
    } finally {
      this.loading.delete(id);
    }
  }
  private async update<T>(
    key: string,
    action: (value: T | undefined) => T,
  ): Promise<T> {
    const deadline = Date.now() + 15000;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (Date.now() > deadline) break;
      const old = await this.store.get<T>(key);
      const value = action(old?.value);
      if (await this.store.put(key, value, old?.etag ?? null)) return value;
      await new Promise((resolve) =>
        setTimeout(resolve, randomInt(10, Math.min(300, 20 + attempt * 20))),
      );
    }
    throw new Error("요청이 많아요. 잠시 후 다시 눌러 주세요.");
  }
  async limit(key: string, count: number, duration: number) {
    await this.update<{ since: number; count: number }>(
      "limits/" + key,
      (old) => {
        const current =
          old && this.now() - old.since < duration
            ? old
            : { since: this.now(), count: 0 };
        check(
          current.count < count,
          "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
        );
        return { ...current, count: current.count + 1 };
      },
    );
  }
  async create(session: string, name: string, requestId: string) {
    // Same session/request yields the same invitation even after a lost HTTP response.
    const key = createHash("sha256")
      .update(session + ":" + requestId)
      .digest();
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(
      key.subarray(0, 6),
      (b) => alphabet[b % alphabet.length],
    ).join("");
    const creationKey = key.toString("hex");
    const old = await this.store.get<StoredRoom>("rooms/" + code);
    if (old?.value.creationKey === creationKey) return old.value;
    check(!old, "방 코드가 겹쳤어요. 다시 방을 만들어 주세요.");
    await this.limit("create-" + session, 6, 3600000);
    const room: StoredRoom = {
      ...newRoom(code, this.now()),
      presence: {},
      creationKey,
    };
    const member = join(room, session, name, this.now());
    room.presence[member.id] = { seen: this.now(), tab: "", controlSeen: 0 };
    if (!(await this.store.put("rooms/" + code, room, null))) {
      const saved = await this.store.get<StoredRoom>("rooms/" + code);
      check(
        saved?.value.creationKey === creationKey,
        "방 생성이 겹쳤어요. 다시 시도해 주세요.",
      );
      return saved.value;
    }
    return room;
  }
  async operate(
    code: string,
    session: string,
    tab: string,
    operation: "join" | "sync" | "command" | "takeover",
    value?: string | Command,
  ) {
    let result!: StoredRoom,
      self = "";
    let race: RaceAsset | undefined;
    const requestDeadline = Date.now() + 25000;
    // Only persisted ETags arbitrate simultaneous requests. No process owns a room.
    for (let attempt = 0; attempt < 40; attempt++) {
      check(
        Date.now() < requestDeadline,
        "요청이 많아요. 잠시 후 다시 눌러 주세요.",
      );
      const saved = await this.store.get<StoredRoom>("rooms/" + code);
      check(saved, "방을 찾을 수 없어요. 코드와 만료 여부를 확인해 주세요.");
      const room = saved.value;
      const before = JSON.stringify(room),
        now = this.now();
      const visibleBefore = JSON.stringify(publicView(room, "", now, false));
      check(
        !room.expiresAt || room.expiresAt > now,
        "만료된 방이에요. 새 방을 만들어 주세요.",
      );
      for (const m of room.members) {
        const last = room.presence[m.id]?.seen ?? room.updatedAt;
        if (m.connected && now - last > 20000)
          disconnect(room, m.id, last + 20000);
      }
      tick(room, now);
      let member = room.members.find((m) => m.session === session && !m.left);
      if (operation === "join")
        member = join(room, session, value as string, now);
      check(member, "먼저 방에 입장해 주세요.");
      self = member.id;
      const presence = (room.presence[self] ??= {
        seen: 0,
        tab: "",
        controlSeen: 0,
      });
      if (
        !presence.tab ||
        operation === "takeover" ||
        (operation === "join" && now - presence.controlSeen > 20000)
      )
        presence.tab = tab;
      if (now - presence.seen >= 5000 || !member.connected) presence.seen = now;
      if (presence.tab === tab && now - presence.controlSeen >= 5000)
        presence.controlSeen = now;
      if (room.phase !== "closed") {
        member.connected = true;
        member.disconnectedAt = undefined;
      }
      // Keep an actively viewed room alive without writing on every poll.
      if (now - room.lastActivity >= 30000 && room.phase !== "closed")
        room.lastActivity = now;
      if (operation === "command") {
        check(
          presence.tab === tab,
          "다른 창에서 조작 중이에요. 이 창에서 조작하기를 눌러 주세요.",
        );
        applyCommand(room, self, value as Command, now);
      }
      const g = room.gameState;
      race = undefined;
      if (
        g &&
        (room.phase === "preparing" || room.phase === "playing") &&
        (room.game === "horse" || room.game === "marble")
      ) {
        race = await this.raceAsset(g);
      }
      if (
        room.phase === "preparing" &&
        this.now() < room.prepareDeadline! &&
        room.members
          .filter((m) => g!.round.participants.some((p) => p.id === m.id))
          .every((m) => m.loaded && m.connected && !m.left)
      )
        begin(room, this.now(), race?.duration);
      result = room;
      if (JSON.stringify(room) === before) break;
      const visibleChanged =
        visibleBefore !== JSON.stringify(publicView(room, "", now, false));
      room.revision++;
      room.updatedAt = this.now();
      if (await this.store.put("rooms/" + code, room, saved.etag)) {
        // Delivery is an optimization: failed notifications are recovered by HTTP sync.
        if (visibleChanged)
          await this.notifications
            .changed(room.id, room.revision)
            .catch(() => {});
        break;
      }
      if (attempt === 39)
        throw new Error("요청이 많아요. 잠시 후 다시 눌러 주세요.");
      await new Promise((resolve) =>
        setTimeout(resolve, randomInt(10, Math.min(300, 20 + attempt * 20))),
      );
    }
    return {
      room: publicView(
        result,
        self,
        this.now(),
        result.presence[self].tab === tab,
      ),
      race:
        result.phase === "playing" && race
          ? frame(result.gameState!, race, this.now())
          : null,
    };
  }
  async member(code: string, session: string) {
    const saved = await this.store.get<StoredRoom>("rooms/" + code);
    check(saved && saved.value.phase !== "closed", "방을 찾을 수 없어요.");
    const member = saved.value.members.find(
      (m) => m.session === session && !m.left,
    );
    check(member, "먼저 방에 입장해 주세요.");
    return { room: saved.value, member };
  }
  async leave(code: string, session: string, tab: string, command: Command) {
    const participating = async () =>
      (await this.store.get<StoredRoom>("rooms/" + code))?.value.members.some(
        (m) => m.session === session && !m.left,
      );
    if (!(await participating())) return;
    try {
      await this.operate(code, session, tab, "command", command);
    } catch (error) {
      // A lost response or another tab may have already completed the departure.
      if (await participating()) throw error;
    }
  }
}
