import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../../shared/protocol";
import { send, useOnline } from "./connection";
import { tracePath } from "../games/ladder/logic";
import { MAPS, WORLD_W } from "../games/marble/maps";
import { sfx } from "../lib/sound";
import { vibrate } from "../lib/device";

type Props = { room: RoomView; now: number; disabled: boolean };
export function OnlineGameView({ room, now, disabled }: Props) {
  const g = room.gameState!;
  const mine = g.participants.some((p) => p.id === room.self);
  const countdown = Math.ceil((g.startAt - now) / 1000);
  const action = (
    action: "reveal" | "pick" | "spin" | "pass",
    index?: number,
  ) => {
    sfx.tap();
    void send({ type: "act", roundId: g.id, turn: g.turn, action, index });
  };
  const previous = useRef(Object.keys(g.revealed).length);
  useEffect(() => {
    const n = Object.keys(g.revealed).length;
    if (n > previous.current) {
      sfx.beep();
      vibrate(40);
    }
    previous.current = n;
  }, [g.revealed]);
  const locked = disabled || countdown > 0 || !mine;
  const current = g.participants.find((p) => p.id === g.current);
  const ownResult = g.revealed[room.self];
  return (
    <>
      {countdown > 0 && (
        <div className="online-countdown" role="status">
          <b className="display">{countdown}</b>
          <span>곧 함께 시작해요</span>
        </div>
      )}
      {!mine && (
        <p className="online-alert">
          이번 판은 관람 중이에요. 다음 판부터 참여할 수 있어요.
        </p>
      )}
      {current && (
        <div
          className={
            "turn-banner " + (g.current === room.self ? "my-turn" : "")
          }
        >
          <span style={{ color: current.color }}>{current.name}</span>
          {g.current === room.self ? " · 내 차례!" : "님의 차례"}
        </div>
      )}
      {room.game === "ladder" && g.ladder && (
        <>
          <svg
            className="online-ladder"
            viewBox={`-0.7 -2 ${g.ladder.cols + 0.4} ${g.ladder.rows + 4}`}
            aria-label="사다리"
          >
            {g.participants.map((p, i) => (
              <g key={p.id}>
                <line
                  x1={i}
                  x2={i}
                  y1={-0.6}
                  y2={g.ladder!.rows + 0.6}
                  stroke="var(--ink-3)"
                  strokeWidth={0.035}
                />
                <text
                  x={i}
                  y={-1.2}
                  fontSize={0.22}
                  textAnchor="middle"
                  fill={p.color}
                >
                  {p.name}
                </text>
              </g>
            ))}
            {g.ladder.rungs.map((r, i) => (
              <line
                key={i}
                x1={r.col}
                x2={r.col + 1}
                y1={r.row + 0.5}
                y2={r.row + 0.5}
                stroke="var(--ink-3)"
                strokeWidth={0.035}
              />
            ))}
            {g.participants
              .filter((p) => g.revealed[p.id])
              .map((p) => {
                const path = tracePath(g.ladder!, g.participants.indexOf(p));
                return (
                  <g key={p.id}>
                    <polyline
                      className="ladder-reveal"
                      points={path.points
                        .map(([x, y]) => `${x},${y}`)
                        .join(" ")}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={0.08}
                    />
                    <text
                      x={path.end}
                      y={g.ladder!.rows + 1.25}
                      fontSize={0.23}
                      textAnchor="middle"
                      fill={p.color}
                    >
                      {g.revealed[p.id].label}
                    </text>
                  </g>
                );
              })}
          </svg>
          <button
            className="btn primary big"
            disabled={locked || !!ownResult}
            onClick={() => action("reveal")}
          >
            {ownResult ? `내 결과: ${ownResult.label}` : "내 사다리 공개"}
          </button>
        </>
      )}
      {room.game === "roulette" && (
        <>
          <div className="online-wheel-wrap">
            <span className="wheel-pointer">▼</span>
            <div
              className={
                "online-wheel " +
                (g.rollingUntil && now < g.rollingUntil ? "rolling" : "")
              }
              style={{
                background: `conic-gradient(${g.participants
                  .filter((p) => !g.revealed[p.id])
                  .map(
                    (p, i, arr) =>
                      `${p.color} ${(i / arr.length) * 100}% ${((i + 1) / arr.length) * 100}%`,
                  )
                  .join(",")})`,
              }}
            >
              <span>복불복</span>
            </div>
          </div>
          <div className="chips">
            {g.participants
              .filter((p) => !g.revealed[p.id])
              .map((p) => (
                <span className="chip" key={p.id}>
                  <i className="dot" style={{ background: p.color }} />
                  {p.name}
                </span>
              ))}
          </div>
          <button
            className="btn primary big"
            disabled={locked || room.self !== room.hostId || !!g.rollingUntil}
            onClick={() => action("spin")}
          >
            {g.rollingUntil
              ? "돌아가는 중…"
              : room.self === room.hostId
                ? "룰렛 돌리기"
                : "방장이 돌려요"}
          </button>
        </>
      )}
      {room.game === "cards" && (
        <div className="online-card-grid">
          {g.participants.map((_, i) => {
            const owner = g.selected[i],
              p = g.participants.find((p) => p.id === owner);
            return (
              <button
                key={i}
                aria-label={`${i + 1}번 카드`}
                className={"online-card " + (owner ? "opened" : "")}
                disabled={locked || g.current !== room.self || !!owner}
                onClick={() => action("pick", i)}
              >
                <span className="display">
                  {owner ? g.revealed[owner]?.label : "?"}
                </span>
                <small>{p?.name ?? `${i + 1}번`}</small>
              </button>
            );
          })}
        </div>
      )}
      {room.game === "pirate" && (
        <>
          <div className="online-pirate">
            <div className="pirate-face">🏴‍☠️</div>
            <div className="online-holes">
              {Array.from({ length: g.holes ?? 0 }, (_, i) => (
                <button
                  key={`${g.step}:${i}`}
                  aria-label={`${i + 1}번 구멍`}
                  disabled={
                    locked || g.current !== room.self || g.used?.includes(i)
                  }
                  className={g.used?.includes(i) ? "used" : ""}
                  onClick={() => action("pick", i)}
                >
                  {g.used?.includes(i) ? "⚔" : i + 1}
                </button>
              ))}
            </div>
          </div>
          <p className="muted online-center">
            통 {g.step + 1} · 구멍 하나를 골라요
          </p>
        </>
      )}
      {room.game === "bomb" && (
        <>
          <button
            className={
              "online-bomb " + (g.current === room.self ? "pulse" : "")
            }
            aria-label="폭탄 넘기기"
            disabled={locked || g.current !== room.self}
            onClick={() => action("pass")}
          >
            <span>💣</span>
            <b>
              {g.current === room.self
                ? "누르고 넘기기"
                : "다음 차례를 기다려요"}
            </b>
          </button>
          <p className="muted online-center">15초가 지나면 자동으로 넘겨요.</p>
        </>
      )}
      {room.game === "scratch" && (
        <Scratch
          key={g.id}
          result={ownResult?.label}
          disabled={locked}
          reveal={() => action("reveal")}
        />
      )}
      {room.game === "stopwatch" && (
        <Stopwatch
          key={`${g.id}:${g.watch.stage}`}
          room={room}
          disabled={locked}
          now={now}
        />
      )}
      {(room.game === "horse" || room.game === "marble") && (
        <Race room={room} />
      )}
      {Object.keys(g.revealed).length > 0 && room.game !== "cards" && (
        <ul className="award-list">
          {g.participants
            .filter((p) => g.revealed[p.id])
            .map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                {p.name}
                <b>{g.revealed[p.id].label}</b>
              </li>
            ))}
        </ul>
      )}
      {g.automatic.length > 0 && (
        <p className="muted">
          입력 시간이 지나 {g.automatic.length}회 자동 진행했어요.
        </p>
      )}
    </>
  );
}

function Scratch({
  result,
  disabled,
  reveal,
}: {
  result?: string;
  disabled: boolean;
  reveal: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    marks = useRef(new Set<string>()),
    sent = useRef(false);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#a4a6bb";
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "#38394f";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("여기를 긁어 보세요", 160, 90);
  }, []);
  return (
    <div className="online-scratch">
      <div className="scratch-label display">{result ?? "행운의 복권"}</div>
      {!result && (
        <canvas
          ref={canvas}
          width={320}
          height={180}
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            if (!disabled) e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (
              disabled ||
              !e.currentTarget.hasPointerCapture(e.pointerId) ||
              sent.current
            )
              return;
            const rect = e.currentTarget.getBoundingClientRect(),
              x = ((e.clientX - rect.left) * 320) / rect.width,
              y = ((e.clientY - rect.top) * 180) / rect.height;
            const ctx = e.currentTarget.getContext("2d")!;
            ctx.globalCompositeOperation = "destination-out";
            ctx.beginPath();
            ctx.arc(x, y, 22, 0, Math.PI * 2);
            ctx.fill();
            marks.current.add(`${Math.floor(x / 20)},${Math.floor(y / 20)}`);
            if (marks.current.size >= 28) {
              sent.current = true;
              reveal();
            }
          }}
        />
      )}
      <button
        className="btn ghost"
        disabled={disabled || !!result}
        onClick={reveal}
      >
        {result ? "공개 완료" : "버튼으로 복권 공개"}
      </button>
    </div>
  );
}

function Stopwatch({
  room,
  disabled,
  now,
}: {
  room: RoomView;
  disabled: boolean;
  now: number;
}) {
  const g = room.gameState!,
    start = useRef<number | null>(null);
  const measured = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0),
    [running, setRunning] = useState(false),
    [invalid, setInvalid] = useState(false),
    [pending, setPending] = useState(false);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      setElapsed(performance.now() - start.current!);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && start.current !== null && running) {
        setRunning(false);
        setInvalid(true);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [running]);
  async function beginWatch() {
    start.current = performance.now();
    setPending(true);
    const ok = await send({
      type: "act",
      roundId: g.id,
      turn: g.turn,
      action: "watch-start",
    });
    setPending(false);
    if (ok) setRunning(true);
    else setInvalid(true);
  }
  async function stopWatch() {
    const time = measured.current ?? performance.now() - start.current!;
    measured.current = time;
    setRunning(false);
    setElapsed(time);
    setPending(true);
    await send({
      type: "act",
      roundId: g.id,
      turn: g.turn,
      action: "watch-stop",
      time,
    });
    setPending(false);
  }
  const eligible = g.watch.eligible.includes(room.self),
    lost = g.watch.started && !g.watch.submitted && start.current === null;
  return (
    <div className="online-watch">
      <h2 className="display">
        {g.watch.stage ? "동점 재도전" : "10초의 감각"}
      </h2>
      <div className="watch ticket">
        <div className="watch-digits display">
          {running && elapsed >= 3000 ? "?.??" : (elapsed / 1000).toFixed(2)}
        </div>
      </div>
      {!eligible ? (
        <p>동점인 참가자가 재도전하고 있어요.</p>
      ) : g.watch.submitted ? (
        <p>제출 완료! 모두 끝나면 결과를 공개해요.</p>
      ) : lost || invalid ? (
        <p role="status">
          이번 측정이 중단되었어요. 새 시도는 발급되지 않으며, 기한 내 미제출로
          처리됩니다.
        </p>
      ) : running ? (
        <button
          className="btn primary big"
          disabled={pending || !room.control}
          onClick={() => void stopWatch()}
        >
          멈춤!
        </button>
      ) : measured.current !== null ? (
        <button
          className="btn primary"
          disabled={disabled || pending || now >= g.deadline}
          onClick={() => void stopWatch()}
        >
          측정 기록 다시 전송
        </button>
      ) : (
        <button
          className="btn primary big"
          disabled={disabled || pending || g.watch.started || now >= g.deadline}
          onClick={() => void beginWatch()}
        >
          측정 시작
        </button>
      )}
      <p className="muted">
        제출 {g.watch.submittedIds.length}/{g.watch.eligible.length}명 · 3초 뒤
        숫자가 사라져요.
      </p>
    </div>
  );
}

function Race({ room }: { room: RoomView }) {
  const race = useOnline((s) => s.race),
    canvas = useRef<HTMLCanvasElement>(null);
  const g = room.gameState!;
  useEffect(() => {
    if (room.game !== "marble" || !race?.mapId) return;
    const cv = canvas.current,
      ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const map = MAPS.find((m) => m.id === race.mapId);
    if (!map) return;
    const scale = cv.width / WORLD_W,
      viewH = cv.height / scale;
    const ys = race.points.map((p) => p.y).sort((a, b) => b - a),
      camera = Math.max(
        0,
        Math.min(map.height - viewH, (ys[0] ?? 0) - viewH * 0.4),
      );
    ctx.setTransform(scale, 0, 0, scale, 0, -camera * scale);
    ctx.fillStyle = "#23254a";
    ctx.fillRect(0, camera, WORLD_W, viewH);
    ctx.fillStyle = "#7f7eaa";
    for (const shape of map.shapes) {
      ctx.save();
      ctx.translate(shape.x, shape.y);
      if (shape.kind === "peg") {
        ctx.beginPath();
        ctx.arc(0, 0, shape.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.rotate(
          shape.kind === "bar"
            ? shape.angle
            : shape.phase +
                (shape.speed * Math.max(0, race.at - g.startAt)) / 1000,
        );
        ctx.fillRect(-shape.w / 2, -shape.h / 2, shape.w, shape.h);
      }
      ctx.restore();
    }
    ctx.fillStyle = "#ffc93c";
    ctx.fillRect(0, map.finishY, WORLD_W, 5);
    for (const point of race.points) {
      const p = g.participants.find((p) => p.id === point.id)!;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.name, point.x, point.y - 15);
    }
  }, [race, room.game, g]);
  if (room.game === "marble")
    return (
      <>
        <canvas
          className="online-marble"
          ref={canvas}
          width={600}
          height={720}
          aria-label="같이 보는 구슬 레이스"
        />
        <p className="muted online-center">
          서버에서 준비한 같은 구슬 경로를 보고 있어요.
        </p>
      </>
    );
  const animals = ["🐎", "🐇", "🐕", "🦊", "🐈", "🐢"];
  return (
    <div className="online-race">
      {g.participants.map((p, i) => {
        const point = race?.points.find((x) => x.id === p.id);
        return (
          <div key={p.id} className="race-lane">
            <span style={{ color: p.color }}>{p.name}</span>
            <div className="race-track">
              <span style={{ left: `${(point?.x ?? 0) * 88}%` }}>
                {animals[i % animals.length]}
              </span>
              <b>🏁</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
