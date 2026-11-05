import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  GAME_INFO,
  type OnlineGame,
  type RoomView,
} from "../../shared/protocol";
import type { OutcomeConfig } from "../core/types";
import { configSummary } from "../core/draw";
import { useApp } from "../store/app";
import { shareResult } from "../lib/share";
import { unlockAudio, sfx } from "../lib/sound";
import {
  connect,
  send,
  session,
  sync,
  takeover,
  useOnline,
} from "./connection";
import { OnlineGameView } from "./OnlineGame";
import "./online.css";

export default function Online() {
  const initialCode =
    window.location.pathname
      .match(/^\/r\/([A-Z2-9]{6})$/i)?.[1]
      ?.toUpperCase() ?? "";
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(
    localStorage.getItem("online-nickname") ?? "",
  );
  const [joined, setJoined] = useState(false);
  const [opening, setOpening] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [qr, setQr] = useState("");
  const [now, setNow] = useState(Date.now());
  const { room, connected, busy, error, offset } = useOnline();
  const prepared = useRef("");
  const create =
    !initialCode &&
    new URLSearchParams(location.search).get("mode") === "create";
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!joined) return;
    const stop = connect(code, name);
    const restore = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", restore);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", restore);
    };
  }, [joined, code, name]);
  useEffect(() => {
    if (
      room?.phase === "preparing" &&
      room.control &&
      connected &&
      room.gameState &&
      prepared.current !== room.gameState.id
    ) {
      prepared.current = room.gameState.id;
      void send({ type: "loaded", roundId: room.gameState.id }).then((ok) => {
        if (!ok) prepared.current = "";
      });
    }
  }, [room, connected]);
  useEffect(() => {
    if (!room) return;
    void QRCode.toDataURL(`${location.origin}/r/${room.code}`, {
      width: 176,
      margin: 2,
    }).then(setQr);
  }, [room?.code]);
  useEffect(() => {
    if (
      room?.phase !== "result" ||
      !room.gameState ||
      !room.results ||
      !room.gameState.participants.some((p) => p.id === room.self)
    )
      return;
    const g = room.gameState;
    const old = useApp.getState().history;
    if (old.some((h) => h.id === g.id)) return;
    useApp.setState({
      history: [
        {
          id: g.id,
          createdAt: g.startAt,
          gameId: g.game,
          participants: g.participants,
          config: g.config,
          seed: g.id,
          results: room.results,
          attempt: 1,
          online: true,
        },
        ...old,
      ].slice(0, 50),
    });
    sfx.win();
  }, [room]);
  async function enter() {
    setOpening(true);
    setEntryError("");
    try {
      unlockAudio();
      await session();
      localStorage.setItem("online-nickname", name.trim());
      if (create) {
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setCode(body.code);
        history.replaceState(null, "", `/r/${body.code}`);
        setJoined(true);
        return;
      }
      if (!/^[A-Z2-9]{6}$/.test(code))
        throw new Error("6자리 방 코드를 확인해 주세요.");
      history.replaceState(null, "", `/r/${code}`);
      setJoined(true);
    } catch (e) {
      setEntryError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }
  // Returning to the same invitation still requires a tap to enable mobile audio.
  if (!joined)
    return (
      <main className="screen online-screen">
        <header className="topbar">
          <a className="icon-btn" href="/" aria-label="홈으로">
            ‹
          </a>
          <h1 className="display">{create ? "방 만들기" : "방 참가하기"}</h1>
        </header>
        <div className="body online-entry">
          <div className="online-mark">🎲</div>
          <h2 className="display">각자 폰으로, 같은 게임</h2>
          <p className="muted">로그인 없이 닉네임만 입력하세요.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enter();
            }}
            className="card online-form"
          >
            <label>
              닉네임
              <input
                aria-label="닉네임"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={8}
                required
                autoComplete="nickname"
                placeholder="최대 8자"
              />
            </label>
            {!create && (
              <label>
                방 코드
                <input
                  aria-label="방 코드"
                  className="room-code-input"
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""),
                    )
                  }
                  maxLength={6}
                  required
                  placeholder="ABC234"
                  autoCapitalize="characters"
                />
              </label>
            )}
            <button
              className="btn primary big"
              disabled={opening || !name.trim()}
            >
              {opening ? "연결 중…" : create ? "방 만들기" : "입장하기"}
            </button>
            {entryError && (
              <p role="alert" className="error">
                {entryError}
              </p>
            )}
          </form>
          <p className="muted">
            같은 브라우저로 다시 들어오면 내 참가자 정보로 연결됩니다.
          </p>
        </div>
      </main>
    );
  if (!room)
    return (
      <main className="screen">
        <div className="body">
          <h1 className="display">방에 연결 중…</h1>
          <p role="alert">{error}</p>
          <button className="btn ghost" onClick={() => setJoined(false)}>
            입장 화면으로
          </button>
        </div>
      </main>
    );
  const host = room.hostId === room.self,
    self = room.members.find((m) => m.id === room.self);
  const disabled = !connected || busy || !room.control;
  const remaining = Math.max(
    0,
    Math.ceil(
      (((room.phase === "preparing"
        ? room.prepareDeadline
        : room.gameState?.deadline) ?? 0) -
        (now + offset)) /
        1000,
    ),
  );
  async function leave() {
    if (window.confirm("방을 나갈까요? 진행 중인 판의 결과는 유지됩니다.")) {
      if (await send({ type: "leave" })) location.assign("/");
    }
  }
  return (
    <main className="screen online-screen">
      <header className="topbar">
        <button
          className="icon-btn"
          onClick={() => void leave()}
          aria-label="방 나가기"
        >
          ×
        </button>
        <h1 className="display">
          {room.phase === "lobby" ? "대기실" : GAME_INFO[room.game].name}
        </h1>
        <span className="tag">{room.code}</span>
      </header>
      <div className="online-connection" role="status">
        <i className={connected ? "connected" : ""} />
        {connected ? "함께 연결됨" : "연결 복구 중… 입력은 잠시 기다려 주세요."}
        <span>{room.members.filter((m) => m.connected).length}명 접속</span>
      </div>
      {!room.control && (
        <div className="card">
          <p>다른 탭에서 조작 중입니다. 이 화면은 보기 상태예요.</p>
          <button className="btn ghost" onClick={() => void takeover()}>
            이 화면에서 조작하기
          </button>
        </div>
      )}
      {error && (
        <p className="error online-alert" role="alert">
          {error}
        </p>
      )}
      {room.notice && (
        <p className="online-alert" role="status">
          {room.notice}
        </p>
      )}
      {room.phase === "closed" ? (
        <div className="body">
          <h2>종료된 방이에요.</h2>
          <a href="/online?mode=create" className="btn primary">
            새 방 만들기
          </a>
          <a href="/">홈으로</a>
        </div>
      ) : (
        <>
          {room.phase === "lobby" && (
            <div className="body">
              <section className="card invite-card">
                <div>
                  <span className="muted">친구 초대</span>
                  <strong className="display room-code">{room.code}</strong>
                  <button
                    className="btn ghost small"
                    onClick={() =>
                      void (
                        navigator.clipboard?.writeText(
                          `${location.origin}/r/${room.code}`,
                        ) ?? Promise.reject()
                      )
                        .then(() =>
                          useOnline.setState({
                            error: "초대 링크를 복사했어요.",
                          }),
                        )
                        .catch(() =>
                          useOnline.setState({
                            error: `초대 주소: ${location.origin}/r/${room.code}`,
                          }),
                        )
                    }
                  >
                    초대 링크 복사
                  </button>
                </div>
                {qr && (
                  <img
                    src={qr}
                    width={112}
                    height={112}
                    alt="방 초대 QR 코드"
                  />
                )}
              </section>
              <section>
                <h2 className="online-label">
                  참가자 <span>{room.members.length}/30</span>
                </h2>
                <ul className="online-members">
                  {room.members.map((m) => (
                    <li key={m.id}>
                      <span className="avatar" style={{ background: m.color }}>
                        {m.name.slice(0, 1)}
                      </span>
                      <span>
                        {m.name}
                        {m.id === room.self ? " (나)" : ""}
                        <small>
                          {m.id === room.hostId
                            ? "방장"
                            : m.spectator
                              ? "다음 판 대기"
                              : "참가자"}
                        </small>
                      </span>
                      <b className={m.ready ? "ready" : ""}>
                        {!m.connected
                          ? "연결 끊김"
                          : m.ready
                            ? "준비 완료"
                            : "준비 전"}
                      </b>
                    </li>
                  ))}
                </ul>
              </section>
              <Settings room={room} disabled={disabled || !host} />
              <div className="online-rules">
                <b>이번 판 약속</b>
                <p>{ruleText(room.game)}</p>
                <p>
                  시작 후 참가자와 결과 설정은 바뀌지 않아요. 연결이 끊겨도 제한
                  시간과 게임은 계속됩니다.
                </p>
              </div>
              <button
                className={"btn big " + (self?.ready ? "ghost" : "primary")}
                disabled={disabled}
                onClick={() => {
                  unlockAudio();
                  void send({ type: "ready", ready: !self?.ready });
                }}
              >
                {self?.ready ? "준비 취소" : "준비 완료"}
              </button>
              {host ? (
                <button
                  className="btn primary big"
                  disabled={
                    disabled ||
                    room.members.filter((m) => !m.spectator).length < 2 ||
                    room.members
                      .filter((m) => !m.spectator)
                      .some((m) => !m.ready || !m.connected)
                  }
                  onClick={() => void send({ type: "prepare" })}
                >
                  게임 시작
                </button>
              ) : (
                <p className="muted online-center">
                  모두 준비하면 방장이 시작할 수 있어요.
                </p>
              )}
            </div>
          )}
          {room.phase === "preparing" && (
            <div className="body online-center">
              <div className="online-mark">🎲</div>
              <h2 className="display">다 같이 준비 중</h2>
              <p>화면과 게임 데이터를 준비하고 있어요.</p>
              <p className="muted">
                {Math.ceil(remaining)}초 안에 준비되지 않으면 대기실로
                돌아갑니다.
              </p>
            </div>
          )}
          {room.phase === "playing" && room.gameState && (
            <div className="body">
              <div className="hud">
                <span>
                  {configSummary(
                    room.config,
                    room.gameState.participants.length,
                  )}
                </span>
                <span>
                  남은 시간 <b>{Math.ceil(remaining)}초</b>
                </span>
              </div>
              <OnlineGameView
                room={room}
                now={now + offset}
                disabled={disabled}
              />
            </div>
          )}
          {room.phase === "result" && room.gameState && room.results && (
            <div className="body">
              <section className="ticket online-result">
                <span className="muted">모두에게 같은 결과</span>
                <h2 className="display">이번 판 결과</h2>
                <ul className="award-list">
                  {room.gameState.participants.map((p) => (
                    <li key={p.id}>
                      <span className="dot" style={{ background: p.color }} />
                      {p.name}
                      <b>{room.results![p.id]?.label}</b>
                    </li>
                  ))}
                </ul>
              </section>
              <p className="muted">
                {room.game === "stopwatch"
                  ? "제출한 측정 기록으로 순위를 정했어요."
                  : room.game === "cards" || room.game === "pirate"
                    ? "시작 전에 배치를 정하고, 각자의 선택으로 결과를 확정했어요."
                    : "서버에서 정한 이번 판의 결과예요."}
              </p>
              <p className="muted">
                자동 진행 {room.gameState.automatic.length}회 · 판{" "}
                {room.gameState.id.slice(0, 8)}
              </p>
              <button
                className="btn ghost"
                onClick={() =>
                  void shareResult({
                    gameName: GAME_INFO[room.game].name,
                    seed: room.gameState!.id,
                    attempt: 1,
                    participants: room.gameState!.participants,
                    results: room.results!,
                    createdAt: room.gameState!.startAt,
                  }).then((message) => useOnline.setState({ error: message }))
                }
              >
                결과 이미지 공유
              </button>
              {host ? (
                <button
                  className="btn primary big"
                  disabled={disabled}
                  onClick={() => void send({ type: "next" })}
                >
                  다음 판 준비하기
                </button>
              ) : (
                <p className="online-center muted">
                  방장이 다음 판을 준비하고 있어요.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Settings({ room, disabled }: { room: RoomView; disabled: boolean }) {
  const [game, setGame] = useState<OnlineGame>(room.game);
  const [mode, setMode] = useState<OutcomeConfig["mode"]>(room.config.mode);
  const [count, setCount] = useState(
    room.config.mode === "loser" ? room.config.count : 1,
  );
  const [label, setLabel] = useState(
    room.config.mode === "loser" ? room.config.label : "꽝",
  );
  const [good, setGood] = useState(
    room.config.mode === "rank" ? false : room.config.good,
  );
  const [items, setItems] = useState(
    room.config.mode === "items"
      ? room.config.items.map((i) => `${i.label}:${i.count}`).join("\n")
      : "밥값:1\n커피:2",
  );
  const signature = JSON.stringify([room.game, room.config]);
  useEffect(() => {
    setGame(room.game);
    setMode(room.config.mode);
    if (room.config.mode === "loser") {
      setCount(room.config.count);
      setLabel(room.config.label);
    }
    if (room.config.mode !== "rank") setGood(room.config.good);
    if (room.config.mode === "items")
      setItems(
        room.config.items.map((i) => `${i.label}:${i.count}`).join("\n"),
      );
  }, [signature]);
  if (room.hostId !== room.self)
    return (
      <section className="card">
        <h2 className="online-label">이번 게임</h2>
        <b>{GAME_INFO[room.game].name}</b>
        <p>
          {configSummary(
            room.config,
            room.members.filter((m) => !m.spectator).length,
          )}
        </p>
      </section>
    );
  async function save() {
    const config: OutcomeConfig =
      mode === "rank"
        ? { mode }
        : mode === "loser"
          ? { mode, count, label, good }
          : {
              mode,
              good,
              items: items
                .split("\n")
                .filter((x) => x.trim())
                .map((line) => {
                  const i = line.lastIndexOf(":");
                  return {
                    label: line.slice(0, i).trim(),
                    count: Number(line.slice(i + 1)),
                  };
                }),
            };
    await send({ type: "configure", game, config });
  }
  return (
    <fieldset className="card online-form" disabled={disabled}>
      <legend>방장 설정</legend>
      <label>
        게임
        <select
          aria-label="게임"
          value={game}
          onChange={(e) => setGame(e.target.value as OnlineGame)}
        >
          {Object.entries(GAME_INFO).map(([id, g]) => (
            <option key={id} value={id}>
              {g.name} · 2~{g.max}명
            </option>
          ))}
        </select>
      </label>
      <label>
        결과 방식
        <select
          aria-label="결과 방식"
          value={mode}
          onChange={(e) => setMode(e.target.value as OutcomeConfig["mode"])}
        >
          <option value="loser">꽝 / 당첨</option>
          <option value="items">항목 나누기</option>
          <option value="rank">전체 순위</option>
        </select>
      </label>
      {mode !== "rank" && (
        <label className="row">
          <input
            type="checkbox"
            checked={good}
            onChange={(e) => setGood(e.target.checked)}
          />
          좋은 결과로 사용
        </label>
      )}
      {mode === "loser" && (
        <>
          <label>
            결과 이름
            <input
              value={label}
              maxLength={30}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            인원
            <input
              type="number"
              min={1}
              max={29}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
        </>
      )}
      {mode === "items" && (
        <label>
          항목:인원 (한 줄에 하나)
          <textarea
            value={items}
            maxLength={600}
            rows={3}
            onChange={(e) => setItems(e.target.value)}
          />
        </label>
      )}
      <button className="btn ghost" type="button" onClick={() => void save()}>
        설정 적용
      </button>
      <small className="muted">설정을 바꾸면 모두 다시 준비해야 해요.</small>
    </fieldset>
  );
}
function ruleText(game: OnlineGame) {
  if (game === "stopwatch")
    return "45초 안에 한 번 측정하고 제출해요. 새로고침해도 재도전은 없어요. 미제출은 뒤 순위로 배정하고, 동점은 한 번 재경기 후 추첨으로 구분해요.";
  if (game === "bomb")
    return "내 차례에 눌러 넘겨요. 15초가 지나면 서버가 자동으로 넘겨요.";
  if (game === "cards" || game === "pirate")
    return "내 차례에 하나를 선택해요. 30초가 지나면 남은 위치 중 무작위로 자동 선택해요.";
  if (game === "scratch")
    return "각자 자신의 복권을 긁어요. 45초 뒤에는 모두 공개해요.";
  if (game === "ladder")
    return "내 줄을 눌러 결과를 공개해요. 30초 뒤에는 모두 공개해요.";
  if (game === "roulette")
    return "방장이 룰렛을 돌려요. 15초 동안 돌리지 않으면 자동으로 진행해요.";
  return "모두 같은 경주를 봐요. 중간에 다시 접속하면 현재 위치부터 이어집니다.";
}
