/**
 * 효과음. 음원 파일 대신 Web Audio로 합성해 라이선스 걱정 없이 오프라인에서도 동작한다.
 * 브라우저는 첫 사용자 탭 전에 소리를 막으므로 unlock()을 첫 탭에서 호출한다.
 */
import { useApp } from '../store/app';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (!useApp.getState().settings.sound) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (!c) return;
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start(0);
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number; delay?: number } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  g.gain.setValueAtTime(opts.gain ?? 0.15, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, opts: { gain?: number; filter?: number; delay?: number } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  // 소리용 잡음이므로 결과 난수와 무관하다.
  let x = 12345;
  for (let i = 0; i < len; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (x / 0x7fffffff) * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = opts.filter ?? 1200;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
}

export const sfx = {
  tick: () => tone(1500, 0.03, { type: 'square', gain: 0.05 }),
  tap: () => tone(660, 0.06, { type: 'triangle', gain: 0.12 }),
  flip: () => tone(420, 0.12, { type: 'triangle', slideTo: 880, gain: 0.12 }),
  start: () => {
    tone(523, 0.1, { type: 'triangle' });
    tone(784, 0.16, { type: 'triangle', delay: 0.1 });
  },
  pass: () => {
    tone(660, 0.1, { type: 'sine', gain: 0.12 });
    tone(990, 0.18, { type: 'sine', gain: 0.1, delay: 0.08 });
  },
  lose: () => {
    tone(392, 0.18, { type: 'sawtooth', gain: 0.1 });
    tone(330, 0.18, { type: 'sawtooth', gain: 0.1, delay: 0.18 });
    tone(262, 0.45, { type: 'sawtooth', gain: 0.1, delay: 0.36, slideTo: 196 });
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.12, delay: i * 0.09 }));
  },
  boom: () => {
    noise(0.9, { gain: 0.6, filter: 600 });
    tone(90, 0.6, { type: 'sine', gain: 0.4, slideTo: 40 });
  },
  fuse: () => noise(0.08, { gain: 0.08, filter: 4000 }),
  scratch: () => noise(0.05, { gain: 0.05, filter: 3000 }),
  pop: () => {
    tone(200, 0.15, { type: 'square', gain: 0.15, slideTo: 900 });
    noise(0.2, { gain: 0.2, filter: 2000, delay: 0.05 });
  },
  knife: () => {
    tone(1800, 0.05, { type: 'triangle', gain: 0.08 });
    noise(0.06, { gain: 0.1, filter: 1500 });
  },
  beep: () => tone(880, 0.12, { type: 'square', gain: 0.08 }),
  warn: () => {
    tone(700, 0.1, { type: 'square', gain: 0.08 });
    tone(700, 0.1, { type: 'square', gain: 0.08, delay: 0.15 });
  },
};

/** 결과 칸에 맞는 소리 */
export function playResult(good: boolean, isPass: boolean) {
  if (isPass) sfx.pass();
  else if (good) sfx.win();
  else sfx.lose();
}
