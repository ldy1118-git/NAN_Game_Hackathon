import type { AudioEngine } from '../core/AudioEngine';
import { C, circle, clamp, lerp, roundRect, shadowed, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { drawBody } from './character';
import { type MiniGame, type RenderInfo } from './MiniGame';
import { decay, prevBeat } from './beat';
import { GROUND_Y, drawStage } from './stage';

/**
 * 튕겨내기 — 랠리형.
 *
 * 상대가 공을 치면 공이 포물선을 그리며 날아오고, 내 라켓에 닿는 순간 스페이스를 친다.
 * 공은 2박짜리 느린 공(파랑)과 1박짜리 빠른 공(분홍) 두 종류이고, 상대가 칠 때 나는
 * 소리의 음높이가 곧 속도다. 즉 귀로 먼저 알고 눈으로 확인하게 된다.
 *
 * 공의 좌표는 오직 박의 함수라서, 프레임이 얼마나 튀든 공은 정확히 정박에 라켓에 닿는다.
 */

const LEAD_IN = 4;
const PHRASES: number[][] = [
  [2, 2, 2, 2],
  [2, 2, 2, 2],
  [2, 1, 1, 2],
  [1, 1, 2, 2],
  [2, 1, 1, 1, 1],
  [1, 1, 2, 1, 1],
  [1, 1, 1, 1, 2, 2],
];

const FOE = { x: 196, racketX: 262, racketY: 292 };
const YOU = { x: 764, racketX: 698, racketY: 292 };
/** 라켓을 휘두른 뒤 자세가 돌아오는 데 걸리는 박. */
const SWING_DECAY = 0.45;

export class RallyBall implements MiniGame {
  readonly id = 'rallyball';
  readonly title = '튕겨내기';
  readonly hint = '공이 라켓에 닿는 순간 스페이스 — 분홍 공은 두 배 빠릅니다';
  readonly order = 20;
  readonly bpm = 132;
  readonly endBeat: number;

  private events: BeatEvent[];

  constructor() {
    const out: BeatEvent[] = [];
    let t = LEAD_IN;

    for (const phrase of PHRASES) {
      for (const travel of phrase) {
        out.push({ beat: t, kind: 'cue', data: { travel } });
        out.push({ beat: t + travel, kind: 'hit', data: { travel, from: t } });
        t += travel;
      }
      // 최소 2박은 쉬되, 다음 악구가 마디 머리에서 시작하도록 4의 배수로 맞춘다.
      const sum = phrase.reduce((a, b) => a + b, 0);
      t += 2 + ((4 - ((sum + 2) % 4)) % 4);
    }

    this.events = out.sort((a, b) => a.beat - b.beat);
    this.endBeat = t + 1;
  }

  build(): BeatEvent[] {
    return this.events;
  }

  /** 랠리답게 조금 더 몰아치는 그루브. */
  groove(step: number, t: number, a: AudioEngine): void {
    const inBar = step % 8;
    if (inBar === 0 || inBar === 3 || inBar === 6) a.kick(t, inBar === 0 ? 1 : 0.7);
    if (inBar === 4) a.snare(t, 0.85);
    a.hat(t, inBar % 2 === 0 ? 0.4 : 0.72);

    const BASS = [98, 0, 0, 98, 0, 0, 87.31, 0];
    const f = BASS[inBar];
    if (f) a.bass(t, f, 0.2, 0.85);
  }

  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    const fast = ev.data?.travel === 1;
    if (fast) {
      // 빠른 공 — 높고 날카롭게.
      a.blip(t, 987.77, 0.75, 'square');
      a.hat(t, 1.1);
    } else {
      a.blip(t, 392, 0.85, 'triangle');
      a.kick(t, 0.4);
    }
  }

  playerSound(t: number, v: Verdict, a: AudioEngine): void {
    if (v === 'miss') {
      a.bad(t);
      return;
    }
    a.blip(t, v === 'perfect' ? 1318.51 : 659.25, 0.7, 'triangle');
    a.snare(t, 0.5);
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    drawStage(g, beat);
    drawNet(g, beat);

    // --- 도착 표시 링: 남은 시간에 비례해 줄어들어 정박에 라켓 크기와 정확히 겹친다 ---
    for (const ev of r.events) {
      if (ev.kind !== 'hit' || ev.verdict) continue;
      const left = ev.beat - beat;
      if (left < 0 || left > 1.5) continue;
      const fast = ev.data?.travel === 1;
      g.save();
      g.globalAlpha = (1 - left / 1.5) * 0.75;
      g.strokeStyle = fast ? C.pink : C.blue;
      g.lineWidth = 4;
      circle(g, YOU.racketX, YOU.racketY, 26 + (left / 1.5) * 130);
      g.stroke();
      g.restore();
    }

    // --- 날아오는 공 ---
    for (const ev of r.events) {
      if (ev.kind !== 'hit') continue;
      const from = ev.data!.from as number;
      const travel = ev.data!.travel as number;
      const p = (beat - from) / travel;
      if (p < 0 || p > 1) continue;
      drawBall(g, p, travel, false);
    }

    // --- 받아넘긴 공 ---
    for (const ev of r.events) {
      if (ev.kind !== 'hit' || !ev.verdict || ev.verdict === 'miss') continue;
      const p = (beat - ev.beat) / 1.4;
      if (p < 0 || p > 1) continue;
      drawBall(g, p, 2, true);
    }

    // --- 상대 ---
    const foeSwing = decay(beat, prevBeat(r.events, 'cue', beat), SWING_DECAY);
    drawBody(g, {
      x: FOE.x,
      y: GROUND_Y,
      w: 84,
      h: 96,
      color: C.mint,
      look: 0.6,
      squash: foeSwing * 0.5,
      hop: foeSwing * 6,
    });
    drawRacket(g, FOE.racketX, FOE.racketY, C.mint, -0.6 + foeSwing * 1.5);

    // --- 나 ---
    const lj = r.lastJudge;
    const hitOk = lj != null && lj.verdict !== 'miss';
    const youSwing = hitOk && lj ? decay(beat, lj.atBeat, SWING_DECAY) : 0;
    const missShake = lj && lj.verdict === 'miss' ? decay(beat, lj.atBeat, SWING_DECAY) : 0;
    drawBody(g, {
      x: YOU.x,
      y: GROUND_Y,
      w: 84,
      h: 96,
      color: C.pink,
      look: -0.6,
      squash: youSwing * 0.5,
      hop: youSwing * 6,
      tilt: missShake * Math.sin(beat * 40) * 0.1,
    });
    drawRacket(g, YOU.racketX, YOU.racketY, C.pink, 0.6 - youSwing * 1.5);

    if (beat < LEAD_IN) {
      text(g, '준비...', 480, 96, { size: 30, color: C.inkSoft, alpha: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * @param p       0(출발) ~ 1(도착)
 * @param travel  2 = 느린 공, 1 = 빠른 공. 호의 높이로도 속도를 알린다.
 * @param back    되받아친 공이면 방향이 반대.
 */
function drawBall(g: CanvasRenderingContext2D, p: number, travel: number, back: boolean): void {
  const fast = travel === 1;
  const from = back ? YOU : FOE;
  const to = back ? FOE : YOU;
  const arc = fast ? 62 : 132;

  const at = (u: number): [number, number] => [
    lerp(from.racketX, to.racketX, u),
    lerp(from.racketY, to.racketY, u) - Math.sin(u * Math.PI) * arc,
  ];

  g.save();
  if (back) g.globalAlpha = 0.45 * (1 - p);

  // 잔상 — 빠른 공일수록 길게 남는다.
  const tail = fast ? 5 : 3;
  for (let i = tail; i >= 1; i--) {
    const [tx, ty] = at(clamp(p - i * 0.022, 0, 1));
    g.globalAlpha *= 0.72;
    g.fillStyle = fast ? C.pink : C.blue;
    circle(g, tx, ty, 13 - i * 1.4);
    g.fill();
  }
  g.restore();

  const [x, y] = at(p);
  g.save();
  if (back) g.globalAlpha = 0.5 * (1 - p);
  shadowed(g, () => circle(g, x, y, 14), fast ? C.pink : C.blue, 4);
  g.strokeStyle = C.ink;
  g.lineWidth = 3;
  circle(g, x, y, 14);
  g.stroke();
  g.restore();
}

function drawRacket(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  angle: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  shadowed(g, () => roundRect(g, -22, -30, 44, 60, 20), color, 5);
  g.strokeStyle = C.ink;
  g.lineWidth = 3.5;
  roundRect(g, -22, -30, 44, 60, 20);
  g.stroke();
  g.fillStyle = C.ink;
  roundRect(g, -5, 28, 10, 26, 5);
  g.fill();
  g.restore();
}

function drawNet(g: CanvasRenderingContext2D, beat: number): void {
  const sway = Math.sin(beat * Math.PI) * 3;
  g.save();
  g.strokeStyle = 'rgba(43, 42, 51, 0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= 6; i++) {
    const x = 480 + (i - 3) * 11;
    g.beginPath();
    g.moveTo(x, GROUND_Y - 96 + Math.abs(i - 3) * 1.5);
    g.lineTo(x + sway, GROUND_Y);
    g.stroke();
  }
  g.strokeStyle = C.ink;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(444, GROUND_Y - 96);
  g.lineTo(516, GROUND_Y - 96);
  g.stroke();
  g.restore();
}
