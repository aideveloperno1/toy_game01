/**
 * 난수 모듈.
 * - seed는 Web Crypto(crypto.getRandomValues)로 만든다.
 * - 결과 배정과 연출 난수는 seed에서 파생한 xoshiro128** PRNG로 만든다.
 *   같은 seed는 항상 같은 판을 재현한다.
 * - Math.random은 쓰지 않는다.
 */

export function createSeed(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 화면에 보여줄 판 번호: seed의 짧은 해시 (예: #A3F9) */
export function seedTag(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return '#' + (h >>> 16).toString(16).toUpperCase().padStart(4, '0');
}

function splitmix32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export interface Prng {
  /** 32비트 부호 없는 정수 */
  u32(): number;
  /** [0, 1) 실수 */
  next(): number;
  /** [0, n) 정수, 모듈로 편향 없음 */
  int(n: number): number;
  /** [min, max) 실수 */
  range(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  /** 같은 seed에서 용도별로 독립된 난수열을 만든다 */
  fork(label: string): Prng;
}

export function createPrng(seed: string): Prng {
  // seed 문자열을 128비트 상태로 압축한다.
  let h = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x85ebca6b) ^ (h >>> 13);
  const sm = splitmix32(h);
  const s = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    // seed hex 조각과 섞어 엔트로피를 보존한다.
    const chunk = seed.slice(i * 8, i * 8 + 8);
    const v = chunk.length === 8 ? parseInt(chunk, 16) >>> 0 : 0;
    s[i] = (sm() ^ v) >>> 0;
  }
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) s[0] = 1;

  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

  const u32 = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  };

  const next = () => u32() / 4294967296;

  const int = (n: number) => {
    if (n <= 0 || !Number.isFinite(n)) throw new Error('int(n): n must be positive');
    // 거부 샘플링으로 모듈로 편향 제거
    const limit = 4294967296 - (4294967296 % n);
    let x = u32();
    while (x >= limit) x = u32();
    return x % n;
  };

  const prng: Prng = {
    u32,
    next,
    int,
    range: (min, max) => min + next() * (max - min),
    pick: (arr) => arr[int(arr.length)],
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    fork: (label) => createPrng(seed + ':' + label),
  };
  return prng;
}

/** seed 없이 즉석에서 쓰는 암호학적 정수 난수 (손가락 뽑기 등) */
export function cryptoInt(n: number): number {
  const limit = 4294967296 - (4294967296 % n);
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}
