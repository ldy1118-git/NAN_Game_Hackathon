import type { AudioEngine } from '../core/AudioEngine';
import { C, W, circle, clamp, easeOut, roundRect, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { drawCharacter, idleBlink, type CastId } from './cast';
import { basicGroove, type MiniGame, type RenderInfo } from './MiniGame';
import { decay } from './beat';
import { GROUND_Y, drawStage } from './stage';

/**
 * 수염 뽑기 — 자라난 수염을 타이밍에 맞춰 뽑는다.
 *
 * 일반 수염은 스페이스 한 번으로, 꼬인 수염은 눌렀다가 정확한 박에 떼야 한다.
 * 수염의 끝 모양만 보고 입력 방식을 즉시 판단하는 것이 핵심이다.
 *
 * 구조:
 *   cue → 수염이 자라기 시작 (data.noteKind 로 종류 구분)
 *   hit → 일반 수염: 정확히 이 박에 Space 한 번
 *   hold → 꼬인 수염: 이 박부터 누르고 endBeat 에 정확히 떼기
 */

type NoteKind = 'tap' | 'hold';
interface BeardNote {
  kind: NoteKind;
  /** 수염이 자라는 데 걸리는 박. */
  grow: number;
  /** 꼬인 수염 전용 — 당기는 박 수. */
  hold?: number;
}

const LEAD_IN = 4;
const CHAR_ID: CastId = 'man2';
const CHAR_H = 200;

/**
 * man2 기준 턱 Y 좌표 (world).
 * man2: headH=56, cy=-72(unscaled), 턱 = cy+headH/2 = -44(unscaled)
 * world Y = GROUND_Y + (-44) * (CHAR_H/100) = GROUND_Y - 88
 */
const CHIN_Y = GROUND_Y - 88;
const MAX_LEN = 90;

const PHRASES: BeardNote[][] = [
  // 1단계: 두 박 일반 수염
  [{ kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }],
  // 2단계: 반복으로 익히기
  [{ kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }],
  // 3단계: 한 박짜리 빠른 수염
  [{ kind: 'tap', grow: 1 }, { kind: 'tap', grow: 1 }, { kind: 'tap', grow: 2 }, { kind: 'tap', grow: 2 }],
  // 4단계: 꼬인 수염 첫 등장
  [{ kind: 'tap', grow: 2 }, { kind: 'hold', grow: 2, hold: 1 }, { kind: 'tap', grow: 2 }],
  // 5단계: 빠른 수염 + 꼬인 수염
  [{ kind: 'tap', grow: 1 }, { kind: 'tap', grow: 1 }, { kind: 'hold', grow: 2, hold: 1 }, { kind: 'tap', grow: 1 }, { kind: 'tap', grow: 1 }],
  // 6단계: 연속 꼬인 수염과 빠른 혼합
  [{ kind: 'tap', grow: 1 }, { kind: 'hold', grow: 1, hold: 1 }, { kind: 'tap', grow: 1 }, { kind: 'hold', grow: 1, hold: 1 }, { kind: 'hold', grow: 2, hold: 2 }],
];

function phraseLen(phrase: BeardNote[]): number {
  return phrase.reduce((s, n) => s + n.grow + (n.kind === 'hold' ? (n.hold ?? 0) : 0), 0);
}

function phrasePad(phrase: BeardNote[]): number {
  const sum = phraseLen(phrase);
  return 2 + ((4 - ((sum + 2) % 4)) % 4);
}

export class BeardPluck implements MiniGame {
  readonly id = 'beardpluck';
  readonly title = '수염 뽑기';
  readonly hint = '일반 수염은 짧게, 꼬인 수염은 꽉 누르고 있다가 놓기 — 스페이스';
  readonly order = 25;
  readonly bpm = 116;
  readonly endBeat: number;

  private pullSound: { stop: (at: number) => void } | null = null;

  constructor() {
    let t = LEAD_IN;
    for (const phrase of PHRASES) {
      t += phraseLen(phrase) + phrasePad(phrase);
    }
    this.endBeat = t + 2;
  }

  build(): BeatEvent[] {
    const out: BeatEvent[] = [];
    let t = LEAD_IN;
    for (const phrase of PHRASES) {
      for (const note of phrase) {
        const cueBeat = t;
        const hitBeat = t + note.grow;
        out.push({ beat: cueBeat, kind: 'cue', data: { noteKind: note.kind } });
        if (note.kind === 'tap') {
          out.push({ beat: hitBeat, kind: 'hit', data: { noteKind: 'tap', cueBeat } });
          t = hitBeat;
        } else {
          const endB = hitBeat + (note.hold ?? 1);
          out.push({ beat: hitBeat, endBeat: endB, kind: 'hold', data: { noteKind: 'hold', cueBeat } });
          t = endB;
        }
      }
      t += phrasePad(phrase);
    }
    return out.sort((a, b) => a.beat - b.beat);
  }

  groove(step: number, t: number, a: AudioEngine): void {
    basicGroove(step, t, a);
  }

  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    const isHold = ev.data?.noteKind === 'hold';
    // 일반: 높고 짧게 / 꼬인: 낮고 거칠게 — 귀로도 구분이 간다
    a.blip(t, isHold ? 392 : 587.33, 0.55, isHold ? 'sawtooth' : 'square');
    a.hat(t, 0.45);
  }

  playerSound(t: number, v: Verdict, a: AudioEngine): void {
    if (v === 'miss') { a.bad(t); return; }
    a.clap(t, v === 'perfect' ? 1.2 : 0.85);
    a.blip(t, v === 'perfect' ? 1046.5 : 783.99, 0.5, 'triangle');
  }

  holdStart(ev: BeatEvent, t: number, _v: Verdict, a: AudioEngine): void {
    this.pullSound?.stop(t);
    const durSec = ((ev.endBeat ?? ev.beat + 1) - ev.beat) * (60 / this.bpm);
    this.pullSound = a.charge(t, durSec);
    a.blip(t, 330, 0.35, 'sawtooth');
  }

  holdEnd(_ev: BeatEvent, t: number, v: Verdict, a: AudioEngine): void {
    this.pullSound?.stop(t);
    this.pullSound = null;
    if (v === 'miss') { a.bad(t); return; }
    a.clap(t, v === 'perfect' ? 1.5 : 1.1);
    a.blip(t, v === 'perfect' ? 1318.51 : 880, 0.6, 'triangle');
    if (v === 'perfect') a.blip(t + 0.08, 1760, 0.4, 'triangle');
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    drawStage(g, beat);

    // 수염 이벤트 그리기 (hit·hold)
    for (const ev of r.events) {
      if (ev.kind !== 'hit' && ev.kind !== 'hold') continue;
      drawBeardEvent(g, ev, beat);
    }

    const lj = r.lastJudge;
    const hitOk = lj != null && lj.verdict !== 'miss';
    const isMiss = lj?.verdict === 'miss';

    const activeHold = r.events.find((e) => e.kind === 'hold' && e.holding);
    const holdP =
      activeHold?.endBeat != null
        ? clamp((beat - activeHold.beat) / (activeHold.endBeat - activeHold.beat), 0, 1)
        : 0;

    drawCharacter(g, {
      id: CHAR_ID,
      x: W / 2,
      y: GROUND_Y,
      h: CHAR_H,
      squash: hitOk && lj ? decay(beat, lj.atBeat, 0.45, 3) * 0.3 : 0,
      tilt: isMiss ? decay(beat, lj!.atBeat, 0.55) * Math.sin(beat * 30) * 0.08 : 0,
      // hold 중이거나 성공 직후 입이 벌어진다
      sing: activeHold
        ? holdP * 0.65
        : hitOk && lj
          ? decay(beat, lj.atBeat, 0.4, 3) * 0.7
          : 0,
      blink: idleBlink(beat, 2),
      // hold 중 팔이 살짝 올라간다 — 억지로 잡고 있는 느낌
      armL: activeHold ? -holdP * 0.25 : 0,
      armR: activeHold ? -holdP * 0.25 : 0,
    });

    if (beat < LEAD_IN - 0.5) {
      text(g, '준비...', W / 2, 90, { size: 28, color: C.inkSoft, alpha: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * hit / hold 이벤트 하나의 수염 상태를 계산하고 그린다.
 *
 * 상태 우선순위:
 *   1. 아직 판정 전 — 자라는 중 / hold 중
 *   2. 성공 — 위로 날아가며 사라짐
 *   3. 실패 — 그 자리에서 서서히 사라짐
 */
function drawBeardEvent(g: CanvasRenderingContext2D, ev: BeatEvent, beat: number): void {
  const isHold = ev.kind === 'hold';
  const cueBeat = ev.data!.cueBeat as number;
  const growDur = ev.beat - cueBeat;

  let growP = 0;
  let holdP = 0;
  let flyY = 0;
  let alpha = 1;

  if (!ev.verdict) {
    if (beat < cueBeat) return;
    if (beat <= ev.beat) {
      growP = growDur > 0 ? clamp((beat - cueBeat) / growDur, 0, 1) : 1;
    } else if (isHold && ev.holding) {
      growP = 1;
      const holdLen = (ev.endBeat! - ev.beat);
      holdP = clamp((beat - ev.beat) / holdLen, 0, 1.08);
    } else {
      growP = 1; // 판정 창 안 — 아직 완전히 자란 상태로 유지
    }
  } else {
    const resolvedBeat =
      ev.verdict !== 'miss' && isHold
        ? (ev.releasedBeat ?? ev.endBeat ?? ev.beat)
        : (ev.pressedBeat ?? ev.beat);
    const age = beat - resolvedBeat;

    if (ev.verdict === 'miss') {
      if (age > 1.5) return;
      growP = 1;
      alpha = Math.max(0, 1 - age / 1.2);
    } else {
      if (age > 0.6) return;
      growP = 1;
      flyY = easeOut(age / 0.6, 2) * 130;
      alpha = Math.max(0, 1 - age / 0.35);
    }
  }

  if (growP <= 0.01) return;

  const len = MAX_LEN * growP;
  drawBeard(g, isHold, len, CHIN_Y - flyY, alpha);

  // hold 진행 게이지
  if (isHold && ev.holding && ev.endBeat != null) {
    drawHoldGauge(g, holdP);
  }

  // 성공 파티클 (tap)
  if (!isHold && ev.verdict && ev.verdict !== 'miss' && ev.pressedBeat != null) {
    const age = beat - ev.pressedBeat;
    if (age >= 0 && age < 0.5) drawParticles(g, age / 0.5);
  }
}

/**
 * 수염 가닥들을 그린다.
 *
 * 일반 수염 — 아래로 약간 퍼지는 세 가닥, 끝이 둥글게 마무리
 * 꼬인 수염 — 같은 세 가닥이지만 끝에 작은 원형 고리가 달린다
 */
function drawBeard(
  g: CanvasRenderingContext2D,
  isHold: boolean,
  len: number,
  topY: number,
  alpha: number,
): void {
  const cx = W / 2;
  const STRANDS = [-10, 0, 10] as const;
  const curlR = Math.max(4, Math.min(7, len * 0.12));

  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = '#3A2515';
  g.lineWidth = isHold ? 4.5 : 3.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const dx of STRANDS) {
    const x = cx + dx;

    if (isHold) {
      // 꼬인 수염: 살짝 구불구불한 가닥 + 끝에 고리
      const curlY = topY + len;

      // 가닥 몸통
      g.beginPath();
      g.moveTo(x, topY);
      g.quadraticCurveTo(x + dx * 0.3, topY + len * 0.5, x, curlY);
      g.stroke();

      // 끝 고리 — 오른쪽으로 시계 방향 원
      g.beginPath();
      g.arc(x + curlR, curlY, curlR, Math.PI, Math.PI * 3, false);
      g.stroke();
    } else {
      // 일반 수염: 아래로 갈수록 약간 벌어지는 직선형 가닥
      const spread = dx * 0.45;
      g.beginPath();
      g.moveTo(x, topY);
      g.quadraticCurveTo(x + spread * 0.3, topY + len * 0.6, x + spread, topY + len);
      g.stroke();
    }
  }

  g.restore();
}

/** hold 진행을 보여주는 게이지 바. 목표선에 닿으면 떼면 된다. */
function drawHoldGauge(g: CanvasRenderingContext2D, holdP: number): void {
  const bw = 130;
  const bh = 13;
  const x = W / 2 - bw / 2;
  const y = CHIN_Y + MAX_LEN + 22;
  const fill = clamp(holdP, 0, 1) * bw;

  g.save();
  // 트랙
  g.fillStyle = 'rgba(43, 42, 51, 0.1)';
  roundRect(g, x, y, bw, bh, 6);
  g.fill();

  // 채움
  if (fill > 1) {
    g.fillStyle = holdP > 0.9 ? C.yellow : C.mint;
    roundRect(g, x, y, fill, bh, 6);
    g.fill();
  }

  // 테두리
  g.strokeStyle = C.ink;
  g.lineWidth = 2;
  roundRect(g, x, y, bw, bh, 6);
  g.stroke();

  // 목표선 (100% 위치에 점선)
  g.strokeStyle = C.pink;
  g.lineWidth = 3;
  g.setLineDash([5, 4]);
  g.beginPath();
  g.moveTo(x + bw, y - 4);
  g.lineTo(x + bw, y + bh + 4);
  g.stroke();
  g.setLineDash([]);
  g.restore();
}

/** tap 성공 직후 수염이 날리는 파티클. t = 0→1. */
function drawParticles(g: CanvasRenderingContext2D, t: number): void {
  const DIRS: [number, number][] = [
    [-1.5, -2.2], [0, -2.6], [1.5, -2.2],
    [2.1, -0.6], [1.5, 0.9], [-1.5, 0.9], [-2.1, -0.6],
  ];
  g.save();
  g.fillStyle = C.yellow;
  g.globalAlpha = 1 - t;
  for (const [dx, dy] of DIRS) {
    const px = W / 2 + dx * 52 * t;
    const py = CHIN_Y + 35 + dy * 52 * t + 45 * t * t;
    const r = 4.5 * (1 - t * 0.55);
    if (r > 0.3) { circle(g, px, py, r); g.fill(); }
  }
  g.restore();
}
