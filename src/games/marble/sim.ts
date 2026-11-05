import Matter from 'matter-js';
import { createPrng } from '../../core/rng';
import { MAPS, MARBLE_R, REC_EVERY, SIM_HZ, WORLD_W, type MarbleMap, type SimResult } from './maps';

export { REC_EVERY, SIM_HZ };

const MAX_SECONDS = 90;
const BOOST_AFTER = 40;


/**
 * 결정론적 시뮬레이션. 구슬은 이름 없이 번호로만 달리고,
 * 끝난 뒤 "도착 순서 p번째 구슬 = 미리 정한 순위 p번째 사람"으로 이름을 붙인다.
 * 그래서 맵의 유불리가 결과에 영향을 주지 않는다.
 */
export function simulate(seed: string, n: number, mapId?: string): SimResult {
  const prng = createPrng(seed).fork('marble');
  const map: MarbleMap = MAPS.find((m) => m.id === mapId) ?? prng.pick(MAPS);
  const engine = Matter.Engine.create({ enableSleeping: false });
  engine.gravity.y = 1;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  const world = engine.world;
  const B = Matter.Bodies;

  const wallOpts = { isStatic: true, friction: 0, restitution: 0.4 };
  Matter.Composite.add(world, [
    B.rectangle(-20, map.height / 2, 40, map.height * 2, wallOpts),
    B.rectangle(WORLD_W + 20, map.height / 2, 40, map.height * 2, wallOpts),
  ]);

  const spinnerBodies: { body: Matter.Body; speed: number; phase: number }[] = [];
  for (const s of map.shapes) {
    if (s.kind === 'peg') Matter.Composite.add(world, B.circle(s.x, s.y, s.r, { isStatic: true, restitution: 0.5, friction: 0 }));
    else if (s.kind === 'bar') Matter.Composite.add(world, B.rectangle(s.x, s.y, s.w, s.h, { isStatic: true, angle: s.angle, friction: 0.0005, restitution: 0.2 }));
    else {
      const body = B.rectangle(s.x, s.y, s.w, s.h, { isStatic: true, angle: s.phase, friction: 0, restitution: 0.6 });
      spinnerBodies.push({ body, speed: s.speed, phase: s.phase });
      Matter.Composite.add(world, body);
    }
  }

  // 출발 자리: 줄 맞춰 놓고 seed로 섞는다
  const perRow = Math.min(n, 12);
  const slots = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const cols = Math.min(perRow, n - row * perRow);
    const span = WORLD_W - 60;
    return { x: 30 + (span / Math.max(1, cols)) * (col + 0.5), y: 40 + row * 24 };
  });
  const placed = prng.shuffle(slots);
  const marbles = placed.map((p) => {
    const m = B.circle(p.x + prng.range(-3, 3), p.y, MARBLE_R, { restitution: 0.45, friction: 0.0005, frictionAir: 0.004, density: 0.002 });
    Matter.Body.setVelocity(m, { x: prng.range(-1, 1), y: 0 });
    return m;
  });
  Matter.Composite.add(world, marbles);

  const maxSteps = MAX_SECONDS * SIM_HZ;
  const frames: number[] = [];
  const finishFrame = new Int32Array(n).fill(-1);
  const order: number[] = [];
  const dt = 1000 / SIM_HZ;

  for (let step = 0; step <= maxSteps; step++) {
    const tSec = step / SIM_HZ;
    for (const s of spinnerBodies) {
      Matter.Body.setAngle(s.body, s.phase + s.speed * tSec);
      Matter.Body.setAngularVelocity(s.body, s.speed / SIM_HZ);
    }
    if (step === BOOST_AFTER * SIM_HZ) engine.gravity.y = 2.2;
    if (step % REC_EVERY === 0) {
      const frame = frames.length / (n * 2);
      for (let i = 0; i < n; i++) {
        const b = marbles[i];
        if (finishFrame[i] < 0 && b.position.y >= map.finishY) {
          finishFrame[i] = frame;
          order.push(i);
        }
        frames.push(b.position.x, Math.min(b.position.y, map.height));
      }
      if (order.length === n) break;
    }
    Matter.Engine.update(engine, dt);
    // 끝난 구슬은 바닥 아래에서 멈춘다
    for (let i = 0; i < n; i++) {
      const b = marbles[i];
      if (b.position.y > map.height - 20) {
        Matter.Body.setStatic(b, true);
      }
    }
  }

  const frameCount = frames.length / (n * 2);
  // 시간 안에 못 들어온 구슬은 더 많이 내려온 순서로
  const stuck = Array.from({ length: n }, (_, i) => i).filter((i) => finishFrame[i] < 0);
  stuck.sort((a, b) => marbles[b].position.y - marbles[a].position.y);
  for (const i of stuck) {
    finishFrame[i] = frameCount - 1;
    order.push(i);
  }

  return { mapId: map.id, n, frames: new Float32Array(frames), frameCount, finishFrame, order };
}
