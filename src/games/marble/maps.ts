/** 구슬 레이스 맵. 시뮬레이션(워커)과 화면 그리기가 같은 정의를 쓴다. */
export const WORLD_W = 400;
export const MARBLE_R = 9;
export const SIM_HZ = 60;
/** 기록 간격(스텝). 30fps로 기록하고 재생할 때 보간한다. */
export const REC_EVERY = 2;

export type SimResult = {
  mapId: string;
  n: number;
  /** 프레임마다 [x0, y0, x1, y1, ...] */
  frames: Float32Array;
  frameCount: number;
  /** 구슬별 도착 프레임 (도착 못 하면 마지막 프레임) */
  finishFrame: Int32Array;
  /** 도착 순서대로의 구슬 번호 */
  order: number[];
};

export type Peg = { kind: 'peg'; x: number; y: number; r: number };
export type Bar = { kind: 'bar'; x: number; y: number; w: number; h: number; angle: number };
/** 일정 속도로 도는 막대: angle(t) = phase + speed * t(초) */
export type Spinner = { kind: 'spinner'; x: number; y: number; w: number; h: number; speed: number; phase: number };
export type Shape = Peg | Bar | Spinner;

export type MarbleMap = { id: string; name: string; height: number; finishY: number; shapes: Shape[] };

const deg = (d: number) => (d * Math.PI) / 180;

function pegField(y0: number, y1: number, dy: number, dx: number, r = 6): Peg[] {
  const out: Peg[] = [];
  let row = 0;
  for (let y = y0; y <= y1; y += dy, row++) {
    const off = row % 2 ? dx / 2 : 0;
    for (let x = 30 + off; x <= WORLD_W - 30; x += dx) out.push({ kind: 'peg', x, y, r });
  }
  return out;
}

/** V자 깔때기: 가운데 gap만 남기고 좁힌다 */
function funnel(y: number, gap = 46): Bar[] {
  const half = (WORLD_W - gap) / 2;
  const len = half / Math.cos(deg(22));
  return [
    { kind: 'bar', x: half / 2, y, w: len, h: 10, angle: deg(22) },
    { kind: 'bar', x: WORLD_W - half / 2, y, w: len, h: 10, angle: deg(-22) },
  ];
}

const basic: MarbleMap = {
  id: 'basic',
  name: '기본',
  height: 2700,
  finishY: 2580,
  shapes: [
    ...pegField(220, 760, 58, 52),
    ...funnel(880),
    ...pegField(1000, 1560, 58, 48),
    ...funnel(1680, 50),
    ...pegField(1800, 2380, 60, 54),
  ],
};

function zigzagRamps(): Bar[] {
  const out: Bar[] = [];
  let y = 240;
  for (let i = 0; i < 12; i++) {
    const left = i % 2 === 0;
    const w = 300;
    out.push({ kind: 'bar', x: left ? w / 2 + 2 : WORLD_W - w / 2 - 2, y, w, h: 10, angle: deg(left ? 13 : -13) });
    y += 175;
  }
  return out;
}

const zigzag: MarbleMap = {
  id: 'zigzag',
  name: '지그재그',
  height: 2700,
  finishY: 2580,
  shapes: [...pegField(110, 170, 40, 60, 5), ...zigzagRamps(), ...pegField(2380, 2480, 50, 56)],
};

const spinners: MarbleMap = {
  id: 'spinner',
  name: '회전 지옥',
  height: 2800,
  finishY: 2680,
  shapes: [
    ...pegField(200, 420, 56, 56),
    { kind: 'spinner', x: 110, y: 560, w: 170, h: 12, speed: 2.2, phase: 0 },
    { kind: 'spinner', x: 290, y: 560, w: 170, h: 12, speed: -2.2, phase: 0.6 },
    ...pegField(700, 900, 56, 60),
    { kind: 'spinner', x: 200, y: 1060, w: 240, h: 12, speed: 1.6, phase: 0.3 },
    ...funnel(1240, 52),
    ...pegField(1360, 1560, 56, 52),
    { kind: 'spinner', x: 100, y: 1720, w: 150, h: 12, speed: -2.6, phase: 1 },
    { kind: 'spinner', x: 300, y: 1720, w: 150, h: 12, speed: 2.6, phase: 0.2 },
    ...pegField(1880, 2100, 56, 56),
    { kind: 'spinner', x: 200, y: 2280, w: 220, h: 12, speed: -1.9, phase: 0.9 },
    ...pegField(2420, 2560, 56, 58),
  ],
};

export const MAPS: MarbleMap[] = [basic, zigzag, spinners];
