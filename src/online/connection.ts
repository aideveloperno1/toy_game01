import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import {
  PROTOCOL,
  type RoomView,
  type RaceFrame,
  type Ack,
  type Command,
} from "../../shared/protocol";
import { useApp } from "../store/app";
import type { HistoryEntry } from "../core/types";

type OnlineState = {
  room: RoomView | null;
  race: RaceFrame | null;
  connected: boolean;
  busy: boolean;
  error: string;
  offset: number;
};
export const useOnline = create<OnlineState>(() => ({
  room: null,
  race: null,
  connected: false,
  busy: false,
  error: "",
  offset: 0,
}));
let socket: Socket | undefined;
function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function session() {
  const response = await fetch("/api/session", { cache: "no-store" });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "온라인 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
    );
  const body = await response.json();
  if (body.protocol !== PROTOCOL)
    throw new Error("새 버전이 필요해요. 화면을 새로고침해 주세요.");
}
export function connect(code: string, name: string) {
  socket?.disconnect();
  const current = io({ autoConnect: false, reconnection: true });
  socket = current;
  current.on("connect", () => {
    current
      .timeout(5000)
      .emit(
        "join",
        { code, name, protocol: PROTOCOL },
        (error: Error | null, ack: Ack) => {
          if (current !== socket) return;
          if (error || !ack?.ok) {
            useOnline.setState({
              error: ack?.error ?? "방에 연결하지 못했어요.",
              connected: false,
            });
            return;
          }
          useOnline.setState({ connected: true, error: "" });
          void fetch(`/api/rooms/${code}/history`, { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) return;
              const entries = (await response.json()) as HistoryEntry[],
                old = useApp.getState().history;
              const merged = new Map(
                [...old, ...entries].map((h) => [h.id, h]),
              );
              useApp.setState({
                history: [...merged.values()]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, 50),
              });
            })
            .catch(() => {});
        },
      );
  });
  current.on("state", (room: RoomView) => {
    if (current !== socket) return;
    if (room.protocol !== PROTOCOL) {
      useOnline.setState({ error: "새 버전이 필요해요. 새로고침해 주세요." });
      return;
    }
    useOnline.setState((s) => {
      if (s.room?.id === room.id && s.room.revision > room.revision) return s;
      return {
        room,
        offset: room.serverNow - Date.now(),
        race: s.room?.gameState?.id === room.gameState?.id ? s.race : null,
      };
    });
  });
  current.on("race-frame", (race: RaceFrame) => {
    if (race.roundId === useOnline.getState().room?.gameState?.id)
      useOnline.setState({ race });
  });
  current.on("disconnect", () =>
    useOnline.setState({ connected: false, busy: false }),
  );
  current.on("connect_error", () =>
    useOnline.setState({
      error: "연결을 다시 시도하고 있어요.",
      connected: false,
    }),
  );
  current.on("service-error", (error: string) => useOnline.setState({ error }));
  current.on("left", () => {
    window.location.assign("/");
  });
  current.connect();
  return () => {
    current.disconnect();
    if (socket === current) socket = undefined;
  };
}
export async function send(value: Omit<Command, "id">): Promise<boolean> {
  const current = socket;
  if (!current?.connected || !useOnline.getState().connected) {
    useOnline.setState({ error: "연결이 복구된 후 다시 눌러 주세요." });
    return false;
  }
  const command: Command = { id: requestId(), ...value };
  useOnline.setState({ busy: true, error: "" });
  try {
    let ack: Ack | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!current.connected)
        throw new Error("연결이 끊겼어요. 복구 후 반영 여부를 확인해 주세요.");
      try {
        ack = (await current
          .timeout(5000)
          .emitWithAck("command", command)) as Ack;
        break;
      } catch {
        if (attempt === 1)
          throw new Error(
            "응답을 확인하지 못했어요. 최신 상태를 다시 확인합니다.",
          );
      }
    }
    if (!ack?.ok) throw new Error(ack?.error ?? "처리하지 못했어요.");
    return true;
  } catch (e) {
    useOnline.setState({ error: (e as Error).message });
    if (current.connected) current.emit("sync");
    return false;
  } finally {
    useOnline.setState({ busy: false });
  }
}
export async function takeover() {
  if (!socket?.connected) return;
  const ack = (await socket
    .timeout(5000)
    .emitWithAck("takeover")
    .catch(() => ({ ok: false, error: "연결을 확인해 주세요." }))) as Ack;
  if (!ack.ok) useOnline.setState({ error: ack.error ?? "" });
}
export function sync() {
  if (socket?.connected) socket.emit("sync");
}
