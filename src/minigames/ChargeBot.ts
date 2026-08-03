import type { AudioEngine } from '../core/AudioEngine';
import { C, W, circle, clamp, easeOut, lerp, roundRect, shadowed, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { decay } from './beat';
import { type MiniGame, type RenderInfo } from './MiniGame';
import { GROUND_Y, drawStage } from './stage';

/**
 * 충전하기 — 누르고 있다가 정확한 박에 떼는 미니게임.
 *
 * 로봇이 컨베이어를 타고 들어오면 스페이스를 눌러 충전을 시작하고, 게이지가 목표선에
 * 닿는 순간 뗀다. 로봇 키가 곧 충전 시간(1·2·3박)이고, 들어올 때 나는 소리의 음높이로도
 * 같은 정보를 준다. 게이지 옆의 눈금은 한 박에 하나씩 지나가서, 세면서 기다릴 수 있다.
 *
 * 앞선 두 게임과 달리 "누른 순간"과 "뗀 순간"을 모두 판정한다.
 * 둘 중 나쁜 쪽이 최종 판정이라 대충 누르고 정확히 떼는 걸로는 완벽이 안 나온다.
 */

const LEAD_IN = 4;
/** 로봇 하나가 차지하는 마디 길이. 등장 2박 + 충전 + 퇴장. */
const SLOT = 6;
const ENTER_BEATS = 2;
const EXIT_BEATS = 2;

/** 각 로봇의 충전 시간(박). 1·2·3박을 섞는다. */
const DURATIONS = [2, 2, 3, 1, 2, 3, 1, 2, 3, 1, 3, 2];

const ROBOT_X = 500;
const OFFSCREEN_R = 1120;
const OFFSCREEN_L = -180;
const NOZZLE_Y = 128;
const BODY_W = 116;

/** 충전 시간별 음높이 — 짧을수록 높다. 눈으로 보기 전에 귀로 먼저 안다. */
const CUE_PITCH: Record<number, number> = { 1: 880, 2: 587.33, 3: 392 };

export class ChargeBot implements MiniGame {
  readonly id = 'chargebot';
  readonly title = '충전하기';
  readonly hint = '스페이스를 누르고 있다가 게이지가 목표선에 닿는 순간 떼세요';
  readonly bpm = 128;
  readonly endBeat = LEAD_IN + DURATIONS.length * SLOT + 2;

  /** 누르는 동안 이어지는 소리의 핸들. 그림에는 쓰지 않는다. */
  private charge: { stop: (at: number) => void } | null = null;

  build(): BeatEvent[] {
    const out: BeatEvent[] = [];
    DURATIONS.forEach((dur, i) => {
      const start = LEAD_IN + i * SLOT;
      // 로봇이 컨베이어에 올라오는 순간 — 크기(=충전 시간)를 알리는 신호.
      out.push({ beat: start - ENTER_BEATS, kind: 'cue', data: { dur } });
      out.push({ beat: start, endBeat: start + dur, kind: 'hold', data: { dur } });
    });
    return out.sort((a, b) => a.beat - b.beat);
  }

  /** 공장 느낌의 그루브 — 하이햇을 촘촘히 깔아 박을 세기 쉽게. */
  groove(step: number, t: number, a: AudioEngine): void {
    const inBar = step % 8;
    if (inBar === 0 || inBar === 5) a.kick(t, inBar === 0 ? 1 : 0.7);
    if (inBar === 4) a.snare(t, 0.85);
    a.hat(t, inBar % 2 === 0 ? 0.5 : 0.3);

    const BASS = [65.41, 0, 0, 65.41, 0, 87.31, 0, 0];
    const f = BASS[inBar];
    if (f) a.bass(t, f, 0.26, 0.9);
  }

  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    const dur = (ev.data?.dur as number) ?? 2;
    a.blip(t, CUE_PITCH[dur] ?? 587.33, 0.8, 'square');
    a.hat(t, 0.9);
  }

  playerSound(t: number, v: Verdict, a: AudioEngine): void {
    if (v === 'miss') a.bad(t);
    else a.blip(t, 660, 0.6, 'triangle');
  }

  holdStart(ev: BeatEvent, t: number, _v: Verdict, a: AudioEngine): void {
    this.charge?.stop(t);
    const durSec = ((ev.endBeat ?? ev.beat) - ev.beat) * (60 / this.bpm);
    this.charge = a.charge(t, durSec);
    a.blip(t, 330, 0.4, 'square');
  }

  holdEnd(_ev: BeatEvent, t: number, v: Verdict, a: AudioEngine): void {
    this.charge?.stop(t);
    this.charge = null;
    if (v === 'miss') {
      a.bad(t);
      return;
    }
    a.good(t);
    if (v === 'perfect') a.blip(t + 0.11, 1760, 0.5, 'triangle');
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    drawStage(g, beat);
    drawConveyor(g, beat);

    for (const ev of r.events) {
      if (ev.kind !== 'hold') continue;
      const x = robotX(ev, beat);
      if (x === null) continue;
      drawRobot(g, ev, beat, x);
    }

    drawNozzle(g, r);

    if (beat < LEAD_IN - ENTER_BEATS) {
      text(g, '누르고 있다가 목표선에서 떼기', W / 2, 92, {
        size: 22,
        color: C.inkSoft,
        weight: 600,
      });
    }
  }
}

// ---------------------------------------------------------------------------

function holdDur(ev: BeatEvent): number {
  return (ev.endBeat ?? ev.beat + 2) - ev.beat;
}

/** 게이지가 찬 비율. 0에서 시작해 endBeat 에 정확히 1이 된다. 1을 넘으면 넘침. */
function fillRatio(ev: BeatEvent, beat: number): number {
  const dur = holdDur(ev);
  if (ev.holding) return Math.max(0, (beat - ev.beat) / dur);
  if (ev.verdict && ev.releasedBeat !== undefined) {
    return Math.max(0, (ev.releasedBeat - ev.beat) / dur); // 뗀 지점에서 멈춘 채로 남는다
  }
  return 0;
}

/** 로봇의 x 좌표. 화면 밖이면 null. 오직 박의 함수라 정박에 정확히 자리에 선다. */
function robotX(ev: BeatEvent, beat: number): number | null {
  const enter = ev.beat - ENTER_BEATS;
  if (beat < enter) return null;

  if (beat < ev.beat) {
    return lerp(OFFSCREEN_R, ROBOT_X, easeOut((beat - enter) / ENTER_BEATS, 3));
  }

  if (ev.verdict) {
    const exitAt = ev.releasedBeat ?? ev.beat + holdDur(ev);
    if (beat > exitAt) {
      const p = (beat - exitAt) / EXIT_BEATS;
      if (p > 1) return null;
      return lerp(ROBOT_X, OFFSCREEN_L, p * p);
    }
  }
  return ROBOT_X;
}

function fillColor(ratio: number): string {
  if (ratio > 1.02) return '#FF4444';
  if (ratio > 0.86) return C.yellow;
  return C.mint;
}

function drawRobot(
  g: CanvasRenderingContext2D,
  ev: BeatEvent,
  beat: number,
  x: number,
): void {
  const dur = holdDur(ev);
  const h = 84 + dur * 30;
  const ratio = fillRatio(ev, beat);
  const over = ratio > 1;

  // 넘치는 중이면 몸이 떨린다
  const shake = over && ev.holding ? Math.sin(beat * 46) * 3.5 : 0;
  // 성공 직후 튀어오름
  const pop =
    ev.verdict && ev.verdict !== 'miss' && ev.releasedBeat !== undefined
      ? decay(beat, ev.releasedBeat, 0.5, 2)
      : 0;

  const top = GROUND_Y - h - pop * 14;

  g.save();
  g.translate(x + shake, 0);

  // 몸통
  shadowed(g, () => roundRect(g, -BODY_W / 2, top, BODY_W, h, 18), C.white, 6);

  // 게이지 — 몸통 안쪽을 아래에서 위로 채운다
  const inset = 11;
  const innerX = -BODY_W / 2 + inset;
  const innerW = BODY_W - inset * 2;
  const innerTop = top + inset;
  const innerH = h - inset * 2;
  const fillH = clamp(ratio, 0, 1) * innerH;

  g.save();
  roundRect(g, innerX, innerTop, innerW, innerH, 10);
  g.clip();
  g.fillStyle = fillColor(ratio);
  g.fillRect(innerX, innerTop + innerH - fillH, innerW, fillH);
  // 수면이 박에 맞춰 일렁인다
  if (ev.holding && fillH > 2) {
    g.globalAlpha = 0.45;
    g.fillStyle = C.white;
    g.fillRect(innerX, innerTop + innerH - fillH, innerW, 3 + Math.sin(beat * Math.PI * 2) * 1.5);
  }
  g.restore();

  // 한 박에 눈금 하나 — 세면서 기다릴 수 있게
  g.strokeStyle = 'rgba(43, 42, 51, 0.28)';
  g.lineWidth = 2;
  for (let i = 1; i < dur; i++) {
    const y = innerTop + innerH - (i / dur) * innerH;
    g.beginPath();
    g.moveTo(innerX + 4, y);
    g.lineTo(innerX + innerW - 4, y);
    g.stroke();
  }

  // 몸통 테두리
  g.strokeStyle = C.ink;
  g.lineWidth = 4;
  roundRect(g, -BODY_W / 2, top, BODY_W, h, 18);
  g.stroke();

  // 목표선 — 여기 닿는 순간이 떼는 순간.
  // 몸통 바깥으로 삼각 표식을 내밀어 테두리와 헷갈리지 않게 한다.
  const nearTarget = ev.holding && ratio > 0.88 && ratio < 1.12;
  const targetColor = nearTarget ? C.pink : C.ink;
  g.save();
  g.strokeStyle = targetColor;
  g.lineWidth = nearTarget ? 4 : 2.5;
  g.setLineDash([9, 6]);
  g.beginPath();
  g.moveTo(innerX, innerTop);
  g.lineTo(innerX + innerW, innerTop);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = targetColor;
  const mark = nearTarget ? 13 : 10;
  for (const sgn of [-1, 1]) {
    const bx = sgn * (BODY_W / 2 + 3);
    g.beginPath();
    g.moveTo(bx, innerTop);
    g.lineTo(bx + sgn * mark, innerTop - mark * 0.62);
    g.lineTo(bx + sgn * mark, innerTop + mark * 0.62);
    g.closePath();
    g.fill();
  }
  g.restore();

  // 눈 — 다 차가면 커진다
  const eyeR = 8 + (ev.holding ? clamp(ratio, 0, 1) * 3.5 : 0);
  g.fillStyle = C.ink;
  for (const sgn of [-1, 1]) {
    circle(g, sgn * 22, top + 34, eyeR);
    g.fill();
  }

  // 결과 표시
  if (ev.verdict && ev.releasedBeat !== undefined) {
    const age = beat - ev.releasedBeat;
    if (age >= 0 && age < 1) {
      g.globalAlpha = 1 - age;
      text(g, ev.verdict === 'miss' ? '✕' : '✓', 0, top - 26, {
        size: 34,
        color: ev.verdict === 'miss' ? C.inkSoft : C.mint,
      });
    }
  }

  g.restore();
}

/** 충전 노즐 — 누르고 있는 동안 아래로 줄기가 내려간다. */
function drawNozzle(g: CanvasRenderingContext2D, r: RenderInfo): void {
  const active = r.events.find((e) => e.kind === 'hold' && e.holding);

  // 천장에서 내려오는 배관 — 노즐이 공중에 뜬 것처럼 보이지 않게.
  g.fillStyle = 'rgba(43, 42, 51, 0.16)';
  g.fillRect(ROBOT_X - 13, 0, 26, NOZZLE_Y - 38);
  g.fillStyle = C.bgDeep;
  g.fillRect(ROBOT_X - 9, 0, 18, NOZZLE_Y - 38);
  for (let y = 16; y < NOZZLE_Y - 44; y += 34) {
    shadowed(g, () => roundRect(g, ROBOT_X - 17, y, 34, 11, 4), C.bgDeep, 3);
  }

  shadowed(g, () => roundRect(g, ROBOT_X - 34, NOZZLE_Y - 44, 68, 52, 12), C.blue, 5);
  g.strokeStyle = C.ink;
  g.lineWidth = 4;
  roundRect(g, ROBOT_X - 34, NOZZLE_Y - 44, 68, 52, 12);
  g.stroke();
  g.fillStyle = C.ink;
  roundRect(g, ROBOT_X - 9, NOZZLE_Y + 6, 18, 16, 4);
  g.fill();

  if (!active) return;

  const dur = holdDur(active);
  const h = 84 + dur * 30;
  const ratio = fillRatio(active, r.beat);
  const surfaceY = GROUND_Y - 11 - (h - 22) * clamp(ratio, 0, 1);

  g.save();
  g.globalAlpha = 0.85;
  g.fillStyle = fillColor(ratio);
  g.fillRect(ROBOT_X - 6, NOZZLE_Y + 20, 12, Math.max(0, surfaceY - NOZZLE_Y - 20));
  // 흘러내리는 느낌의 밝은 점
  g.globalAlpha = 0.5;
  g.fillStyle = C.white;
  for (let i = 0; i < 4; i++) {
    const y = NOZZLE_Y + 24 + ((r.beat * 420 + i * 46) % Math.max(1, surfaceY - NOZZLE_Y - 30));
    if (y < surfaceY - 4) {
      g.fillRect(ROBOT_X - 3, y, 6, 10);
    }
  }
  g.restore();
}

/** 컨베이어 벨트 — 박에 맞춰 한 칸씩 움직인다. */
function drawConveyor(g: CanvasRenderingContext2D, beat: number): void {
  const y = GROUND_Y;
  g.save();
  g.strokeStyle = 'rgba(43, 42, 51, 0.22)';
  g.lineWidth = 3;
  const step = 44;
  // 한 박에 정확히 한 칸씩 흐른다 — 배경만 봐도 박이 보인다.
  const shift = (beat % 1) * step;
  for (let x = -step; x < W + step; x += step) {
    g.beginPath();
    g.moveTo(x - shift, y + 8);
    g.lineTo(x - shift + 14, y + 26);
    g.stroke();
  }
  g.restore();
}
