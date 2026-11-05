import { create } from "zustand";
import {
  PROTOCOL,
  type RoomView,
  type RaceFrame,
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
export function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let tab = sessionStorage.getItem("game-tab") ?? requestId();
sessionStorage.setItem("game-tab", tab);
const documentId = requestId();
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("game-tabs")
    : undefined;
// Duplicating a tab can copy sessionStorage: the later document gets a new controller ID.
channel?.addEventListener("message", (event) => {
  if (event.data?.tab !== tab || event.data.documentId === documentId) return;
  if (event.data.type === "hello")
    channel.postMessage({
      type: "occupied",
      tab,
      documentId,
      target: event.data.documentId,
    });
  if (event.data.type === "occupied" && event.data.target === documentId) {
    tab = requestId();
    sessionStorage.setItem("game-tab", tab);
  }
});
channel?.postMessage({ type: "hello", tab, documentId });
type Connection = {
  code: string;
  stopped: boolean;
  joined: boolean;
  polling: boolean;
  timer?: ReturnType<typeof setTimeout>;
  socket?: WebSocket;
  negotiateAt: number;
  abort: AbortController;
  poll: () => Promise<void>;
};
let active: Connection | undefined;
async function post(
  code: string,
  operation: string,
  extra: object = {},
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/rooms/${code}/${operation}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Game-Request": "1" },
    body: JSON.stringify({ protocol: PROTOCOL, tab, ...extra }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "연결을 확인해 주세요.");
  return body;
}
function accept(
  current: Connection,
  data: { room: RoomView; race: RaceFrame | null },
  sent: number,
) {
  if (active !== current || current.stopped) return;
  const room = data.room;
  if (room.protocol !== PROTOCOL)
    throw new Error("새 버전이 필요해요. 새로고침해 주세요.");
  useOnline.setState((s) => {
    if (
      s.room?.id === room.id &&
      (s.room.revision > room.revision ||
        (s.room.revision === room.revision &&
          s.room.serverNow > room.serverNow))
    )
      return s;
    return {
      room,
      race: data.race,
      connected: true,
      error: s.connected ? s.error : "",
      offset: room.serverNow - (sent + Date.now()) / 2,
    };
  });
}
export async function session() {
  const response = await fetch("/api/session", {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "온라인 서버에 연결할 수 없어요. 서비스 설정을 확인해 주세요.",
    );
  if ((await response.json()).protocol !== PROTOCOL)
    throw new Error("새 버전이 필요해요. 새로고침해 주세요.");
}
async function negotiate(current: Connection) {
  if (current.stopped || current.socket || Date.now() < current.negotiateAt)
    return;
  current.negotiateAt = Date.now() + 30000;
  try {
    const { url } = await post(
      current.code,
      "negotiate",
      {},
      current.abort.signal,
    );
    if (!url || current.stopped) return;
    const socket = new WebSocket(url, "json.webpubsub.azure.v1");
    current.socket = socket;
    socket.onopen = () => sync();
    socket.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).type === "message") sync();
      } catch {
        /* Protocol message. */
      }
    };
    socket.onclose = () => {
      current.socket = undefined;
    };
    socket.onerror = () => socket.close();
  } catch {
    /* HTTP synchronization remains available during a PubSub outage. */
  }
}
export function connect(code: string, name: string) {
  const current: Connection = {
    code,
    stopped: false,
    joined: false,
    polling: false,
    negotiateAt: 0,
    abort: new AbortController(),
    poll,
  };
  active = current;
  useOnline.setState({ room: null, race: null, connected: false, error: "" });
  async function poll() {
    if (current.stopped || current.polling) return;
    current.polling = true;
    const sent = Date.now();
    try {
      const first = !current.joined;
      const data = await post(
        code,
        first ? "join" : "sync",
        first ? { name } : {},
        current.abort.signal,
      );
      current.joined = true;
      accept(current, data, sent);
      void negotiate(current);
      if (first)
        void fetch(`/api/rooms/${code}/history`, {
          cache: "no-store",
          signal: current.abort.signal,
        })
          .then(async (response) => {
            if (!response.ok || current.stopped) return;
            const entries: HistoryEntry[] = await response.json();
            const merged = new Map(
              [...useApp.getState().history, ...entries].map((h) => [h.id, h]),
            );
            useApp.setState({
              history: [...merged.values()]
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 50),
            });
          })
          .catch(() => {});
    } catch (e) {
      if (!current.stopped)
        useOnline.setState({ connected: false, error: (e as Error).message });
    } finally {
      current.polling = false;
      if (!current.stopped) {
        clearTimeout(current.timer);
        const s = useOnline.getState();
        // Requests drive due deadlines; managed Functions need no background timer.
        current.timer = setTimeout(
          poll,
          !s.connected
            ? 3000
            : s.room?.phase === "playing" || s.room?.phase === "preparing"
              ? 500
              : 1500,
        );
      }
    }
  }
  void poll();
  return () => {
    current.stopped = true;
    current.abort.abort();
    clearTimeout(current.timer);
    current.socket?.close();
    if (active === current) {
      active = undefined;
      useOnline.setState({ connected: false });
    }
  };
}
export async function send(value: Omit<Command, "id">): Promise<boolean> {
  const current = active;
  if (!current || !useOnline.getState().connected) {
    useOnline.setState({ error: "연결이 복구된 후 다시 눌러 주세요." });
    return false;
  }
  const command = { id: requestId(), ...value };
  useOnline.setState({ busy: true, error: "" });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const sent = Date.now();
      try {
        const data = await post(
          current.code,
          "command",
          { command },
          current.abort.signal,
        );
        if (value.type === "leave") window.location.assign("/");
        else accept(current, data, sent);
        return true;
      } catch (e) {
        if (attempt === 1 || current.stopped) throw e;
      }
    }
    return false;
  } catch (e) {
    if (!current.stopped) {
      useOnline.setState({ error: (e as Error).message });
      sync();
    }
    return false;
  } finally {
    if (!current.stopped) useOnline.setState({ busy: false });
  }
}
export async function takeover() {
  const current = active;
  if (!current) return;
  const sent = Date.now();
  try {
    accept(
      current,
      await post(current.code, "takeover", {}, current.abort.signal),
      sent,
    );
  } catch (e) {
    useOnline.setState({ error: (e as Error).message });
  }
}
export function sync() {
  if (!active) return;
  clearTimeout(active.timer);
  void active.poll();
}
