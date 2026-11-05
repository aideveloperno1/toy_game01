import { randomInt } from "node:crypto";
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
} from "./engine";
import { buildRace, frame, type RaceAsset } from "./races";
import type { Store } from "./storage";
import type { Command } from "../shared/protocol";

export class RoomService {
  rooms = new Map<string, Room>();
  assets = new Map<string, RaceAsset>();
  onChange: (room: Room) => void = () => {};
  private queues = new Map<string, Promise<unknown>>();
  private raceJobs = new Set<Promise<unknown>>();
  constructor(
    readonly store: Store,
    readonly now = Date.now,
  ) {}
  async initialize() {
    const now = this.now();
    for (const original of await this.store.load()) {
      if (original.expiresAt && original.expiresAt < now) {
        await this.store.remove(original);
        continue;
      }
      const room = structuredClone(original);
      room.completed ??= [];
      room.members.forEach((m) => {
        m.connected = false;
        m.ready = false;
        m.disconnectedAt = now;
      });
      if (room.phase === "playing" || room.phase === "preparing") {
        if (room.gameState)
          await this.store.removeAsset(room.gameState.round.id);
        room.phase = "lobby";
        room.gameState = undefined;
        room.results = undefined;
        room.notice =
          "서버가 다시 시작되어 진행 중이던 판은 무효 처리되었어요. 준비 후 새 판을 시작해 주세요.";
      }
      room.revision++;
      await this.store.save(room, original.revision);
      this.rooms.set(room.code, room);
    }
  }
  serial<T>(code: string, action: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(code) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(action);
    this.queues.set(code, task);
    void task
      .finally(() => {
        if (this.queues.get(code) === task) this.queues.delete(code);
      })
      .catch(() => {});
    return task;
  }
  private async commit(room: Room, expected: number) {
    room.revision = expected + 1;
    room.updatedAt = this.now();
    await this.store.save(room, expected);
    this.rooms.set(room.code, room);
    this.onChange(room);
  }
  async create(session: string, name: string) {
    return this.serial("__create", async () => {
      check(
        this.rooms.size < 500,
        "지금은 방이 많아요. 잠시 후 다시 시도해 주세요.",
      );
      check(
        [...this.rooms.values()].filter(
          (r) =>
            r.phase !== "closed" &&
            r.members.some((m) => m.session === session && !m.left),
        ).length < 3,
        "참여 중인 방을 나간 뒤 새 방을 만들어 주세요.",
      );
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code: string;
      do {
        code = Array.from(
          { length: 6 },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
      } while (this.rooms.has(code));
      const room = newRoom(code, this.now());
      join(room, session, name, this.now());
      await this.commit(room, -1);
      return room;
    });
  }
  get(code: string) {
    const room = this.rooms.get(code);
    check(room, "방을 찾을 수 없어요. 코드와 만료 여부를 확인해 주세요.");
    return room;
  }
  async connect(code: string, session: string, name: string) {
    return this.serial(code, async () => {
      const old = this.get(code),
        room = structuredClone(old);
      const member = join(room, session, name, this.now());
      await this.commit(room, old.revision);
      return member.id;
    });
  }
  async disconnect(code: string, id: string) {
    return this.serial(code, async () => {
      const old = this.get(code),
        room = structuredClone(old);
      disconnect(room, id, this.now());
      await this.commit(room, old.revision);
    });
  }
  async command(code: string, id: string, command: Command) {
    await this.serial(code, async () => {
      const old = this.get(code),
        room = structuredClone(old);
      const updated = applyCommand(room, id, command, this.now());
      if (updated) await this.commit(room, old.revision);
    });
    if (command.type === "prepare") {
      const g = this.get(code).gameState;
      if (
        g &&
        (g.round.gameId === "horse" || g.round.gameId === "marble") &&
        !this.assets.has(g.round.id)
      ) {
        const job = buildRace(g)
          .then(async (asset) => {
            await this.serial(code, async () => {
              const room = this.get(code);
              if (
                room.phase !== "preparing" ||
                room.gameState?.round.id !== g.round.id
              )
                return;
              await this.store.asset(g.round.id, JSON.stringify(asset));
              this.assets.set(g.round.id, asset);
            });
            await this.maybeBegin(code);
          })
          .catch(async () => {
            await this.serial(code, async () => {
              const old = this.get(code);
              if (
                old.phase !== "preparing" ||
                old.gameState?.round.id !== g.round.id
              )
                return;
              const room = structuredClone(old);
              room.phase = "lobby";
              room.gameState = undefined;
              room.members.forEach((m) => {
                m.ready = false;
              });
              room.notice = "경주 준비에 실패했어요. 다시 준비해 주세요.";
              await this.commit(room, old.revision);
            }).catch(() => {});
          });
        this.raceJobs.add(job);
        void job.finally(() => this.raceJobs.delete(job));
      }
    }
    await this.maybeBegin(code);
  }
  async maybeBegin(code: string) {
    await this.serial(code, async () => {
      const old = this.get(code);
      if (
        old.phase !== "preparing" ||
        this.now() >= old.prepareDeadline! ||
        !old.members
          .filter((m) =>
            old.gameState!.round.participants.some((p) => p.id === m.id),
          )
          .every((m) => m.loaded && m.connected && !m.left)
      )
        return;
      const g = old.gameState!,
        race = old.game === "horse" || old.game === "marble";
      const asset = this.assets.get(g.round.id);
      if (race && !asset) return;
      const room = structuredClone(old);
      begin(room, this.now(), asset?.duration);
      await this.commit(room, old.revision);
    });
  }
  async sweep() {
    await Promise.all(
      [...this.rooms.keys()].map((code) =>
        this.serial(code, async () => {
          const old = this.get(code);
          if (old.expiresAt && old.expiresAt < this.now()) {
            await this.store.remove(old);
            this.rooms.delete(code);
            return;
          }
          const room = structuredClone(old);
          if (tick(room, this.now())) await this.commit(room, old.revision);
          const current = this.get(code);
          for (const [id] of this.assets)
            if (
              old.gameState?.round.id === id &&
              current.phase !== "playing" &&
              current.phase !== "preparing"
            ) {
              await this.store.removeAsset(id);
              this.assets.delete(id);
            }
        }),
      ),
    );
    const live = new Set(
      [...this.rooms.values()]
        .filter((r) => r.phase === "playing" || r.phase === "preparing")
        .map((r) => r.gameState?.round.id),
    );
    for (const [id] of this.assets)
      if (!live.has(id)) {
        await this.store.removeAsset(id);
        this.assets.delete(id);
      }
  }
  view(code: string, id: string, control: boolean) {
    return publicView(this.get(code), id, this.now(), control);
  }
  async drain() {
    while (this.queues.size || this.raceJobs.size)
      await Promise.allSettled([...this.queues.values(), ...this.raceJobs]);
  }
  raceFrame(code: string) {
    const room = this.get(code),
      g = room.gameState;
    if (room.phase !== "playing" || !g) return;
    const asset = this.assets.get(g.round.id);
    if (asset) return frame(g, asset, this.now());
  }
}
