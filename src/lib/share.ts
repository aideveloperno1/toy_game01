import { groupResults } from '../core/draw';
import { seedTag } from '../core/rng';
import type { Participant, RoundResult } from '../core/types';

type ShareInput = {
  gameName: string;
  seed: string;
  attempt: number;
  participants: Participant[];
  results: RoundResult;
  createdAt: number;
};

export function resultText(input: ShareInput): string {
  const groups = groupResults(input.results, input.participants);
  const lines = groups.map((g) => `${g.slot.label}: ${g.people.map((p) => p.name).join(', ')}`);
  const date = new Date(input.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const again = input.attempt > 1 ? ` (재경기 ${input.attempt}회차)` : '';
  return `[복불복] ${input.gameName} ${seedTag(input.seed)}${again}\n${date}\n\n${lines.join('\n')}`;
}

/** 결과 카드를 PNG로 그린다 */
export async function resultImage(input: ShareInput): Promise<Blob | null> {
  const groups = groupResults(input.results, input.participants);
  const W = 720;
  const rowH = 64;
  const H = 260 + groups.reduce((s, g) => s + 56 + Math.ceil(g.people.length / 3) * rowH, 0) + 60;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  try {
    await document.fonts?.load('48px Jua');
  } catch {
    /* 폰트가 없으면 기본 글꼴 */
  }
  const display = '"Jua", system-ui, sans-serif';
  const body = 'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  g.fillStyle = '#191a36';
  g.fillRect(0, 0, W, H);
  // 티켓 본체
  g.fillStyle = '#23254a';
  roundRect(g, 32, 32, W - 64, H - 64, 28);
  g.fill();
  // 좌우 홈
  g.fillStyle = '#191a36';
  for (const x of [32, W - 32]) {
    g.beginPath();
    g.arc(x, 200, 22, 0, Math.PI * 2);
    g.fill();
  }
  g.setLineDash([10, 10]);
  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(70, 200);
  g.lineTo(W - 70, 200);
  g.stroke();
  g.setLineDash([]);

  g.fillStyle = '#ffc93c';
  g.font = `56px ${display}`;
  g.fillText('복불복', 72, 112);
  g.fillStyle = '#b4b3d6';
  g.font = `600 26px ${body}`;
  const again = input.attempt > 1 ? ` · 재경기 ${input.attempt}회차` : '';
  g.fillText(`${input.gameName} ${seedTag(input.seed)}${again}`, 72, 160);

  let y = 260;
  for (const grp of groups) {
    const tone = grp.slot.kind === 'pass' ? '#4fd8b4' : grp.slot.kind === 'rank' ? (grp.slot.rank === 1 ? '#ffc93c' : '#b4b3d6') : grp.slot.good ? '#ffc93c' : '#ff5a6e';
    g.fillStyle = tone;
    g.font = `40px ${display}`;
    g.fillText(grp.slot.label, 72, y);
    y += 22;
    grp.people.forEach((p, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 72 + col * 196;
      const yy = y + row * rowH + 30;
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(x + 16, yy - 10, 16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f5f2ff';
      g.font = `700 30px ${body}`;
      g.fillText(p.name, x + 42, yy);
    });
    y += Math.ceil(grp.people.length / 3) * rowH + 34;
  }
  return new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 공유: 이미지 공유 → 텍스트 공유 → 이미지 저장 순서로 시도한다. 결과 메시지를 돌려준다. */
export async function shareResult(input: ShareInput): Promise<string> {
  const text = resultText(input);
  const blob = await resultImage(input);
  const file = blob ? new File([blob], `bokbulbok-${seedTag(input.seed).slice(1)}.png`, { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return '공유했어요';
    }
    if (navigator.share) {
      await navigator.share({ text });
      return '공유했어요';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return '';
  }
  if (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file!.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* 클립보드 권한 없음 */
    }
    return '결과 이미지를 저장했어요';
  }
  return '공유할 수 없는 브라우저예요';
}
