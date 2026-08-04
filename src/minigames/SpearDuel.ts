import type { AudioEngine } from '../core/AudioEngine';
import { C, W, circle, clamp, easeOut, lerp, roundRect, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { shockRing } from './character';
import { drawCharacter, idleBlink, type CastId } from './cast';
import { basicGroove, type MiniGame, type RenderInfo } from './MiniGame';
import { decay, nextBeat, windUp } from './beat';
import { GROUND_Y, drawStage } from './stage';

/**
 * 창 결투 — 날아오는 창을 타이밍에 맞춰 튕겨내고, 적이 지치는 순간 반격한다.
 *
 * 적이 공격 신호(창이 빛남)를 보내면 창이 날아온다 — 정박에 스페이스로 막아낸다.
 * 반격 구간(hold)엔 스페이스를 꾹 눌러 에너지를 모으고 정확히 떼면 강타를 날린다.
 * 성공할수록 적의 HP가 닳는다.
 */

const LEAD_IN = 4;
const PHRASE_GAP = 2;

type NoteKind = 'tap' | 'hold';
interface DuelNote {
  kind: NoteKind;
  travel: number;
  hold?: number;
}

const PHRASES: DuelNote[][] = [
  // 1단계: 느린 단타 — 두 박마다
  [{ kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }],
  // 2단계: 반복으로 익히기
  [{ kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }],
  // 3단계: 1박 빠른 공격 추가
  [{ kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 2 }],
  // 4단계: hold 반격 첫 등장
  [{ kind: 'tap', travel: 2 }, { kind: 'tap', travel: 2 }, { kind: 'hold', travel: 2, hold: 2 }, { kind: 'tap', travel: 2 }],
  // 5단계: 빠른 단타 + hold 혼합
  [{ kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 2 }, { kind: 'hold', travel: 2, hold: 2 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }],
  // 6단계: 폭풍 구간 — 이걸 버텨야 한다
  [{ kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }, { kind: 'hold', travel: 2, hold: 1 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }, { kind: 'tap', travel: 1 }],
];

const ENEMY_X = 220;
const PLAYER_X = 740;
const BODY_H = 150;
const ENEMY_ID: CastId = 'man2';
const PLAYER_ID: CastId = 'man1';

export class SpearDuel implements MiniGame {
  readonly id = 'spearduel';
  readonly title = '창 결투';
  readonly hint = '창이 날아오는 순간 막아라! — 스페이스';
  readonly order = 35;
  readonly bpm = 120;
  readonly endBeat: number;

  private chargeSound: { stop: (at: number) => void } | null = null;
  private readonly totalHits: number;

  constructor() {
    let t = LEAD_IN;
    for (const phrase of PHRASES) {
      for (const note of phrase) t += note.travel + (note.hold ?? 0);
      t += PHRASE_GAP;
    }
    this.endBeat = t + 2;
    this.totalHits = PHRASES.reduce((s, p) => s + p.length, 0);
  }

  build(): BeatEvent[] {
    const out: BeatEvent[] = [];
    let t = LEAD_IN;
    for (const phrase of PHRASES) {
      for (const note of phrase) {
        out.push({ beat: t, kind: 'cue', data: { travel: note.travel, noteKind: note.kind } });
        if (note.kind === 'tap') {
          out.push({ beat: t + note.travel, kind: 'hit', data: { travel: note.travel, from: t } });
          t += note.travel;
        } else {
          const hd = note.hold ?? 2;
          out.push({ beat: t + note.travel, endBeat: t + note.travel + hd, kind: 'hold', data: { from: t, hd } });
          t += note.travel + hd;
        }
      }
      t += PHRASE_GAP;
    }
    return out.sort((a, b) => a.beat - b.beat);
  }

  groove(step: number, t: number, a: AudioEngine): void {
    basicGroove(step, t, a);
    // 전투감을 살리기 위해 강박에 추가 타격음
    if (step % 8 === 0) a.kick(t, 0.35);
  }

  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    if ((ev.data?.noteKind as string) === 'hold') {
      // 낮고 위협적인 소리 — 큰 공격이 온다
      a.blip(t, 220, 0.7, 'square');
      a.hat(t, 0.85);
    } else {
      const fast = (ev.data?.travel as number) <= 1;
      a.blip(t, fast ? 660 : 440, 0.55, 'sine');
      if (fast) a.hat(t, 0.9);
    }
  }

  playerSound(t: number, v: Verdict, a: AudioEngine): void {
    if (v === 'miss') { a.bad(t); return; }
    // 쨍 — 창이 막힌 소리
    a.clap(t, v === 'perfect' ? 1.3 : 0.9);
    a.blip(t, v === 'perfect' ? 1318.51 : 880, 0.5, 'triangle');
  }

  holdStart(ev: BeatEvent, t: number, _v: Verdict, a: AudioEngine): void {
    this.chargeSound?.stop(t);
    const durSec = ((ev.endBeat ?? ev.beat) - ev.beat) * (60 / this.bpm);
    this.chargeSound = a.charge(t, durSec);
    a.blip(t, 330, 0.4, 'square');
  }

  holdEnd(_ev: BeatEvent, t: number, v: Verdict, a: AudioEngine): void {
    this.chargeSound?.stop(t);
    this.chargeSound = null;
    if (v === 'miss') { a.bad(t); return; }
    a.good(t);
    a.blip(t, v === 'perfect' ? 1760 : 1100, 0.6, 'triangle');
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    drawStage(g, beat);

    // HP 계산 — 성공 횟수를 세어 순수하게 beat 의 함수로 동작
    const successCount = r.events.filter(
      e => (e.kind === 'hit' || e.kind === 'hold') && e.verdict && e.verdict !== 'miss',
    ).length;
    drawHpBars(g, Math.max(0, 1 - successCount / this.totalHits));

    // 날아오는 창 (tap 공격)
    for (const ev of r.events) {
      if (ev.kind !== 'hit' || ev.verdict) continue;
      const from = ev.data!.from as number;
      const travel = ev.data!.travel as number;
      const p = clamp((beat - from) / travel, 0, 1);
      if (p > 0 && p < 1) drawSpear(g, ENEMY_X + 60, PLAYER_X - 60, p, false);
    }

    // 적이 에너지 모으는 시각 (hold cue)
    for (const ev of r.events) {
      if (ev.kind !== 'cue' || (ev.data!.noteKind as string) !== 'hold') continue;
      const travel = ev.data!.travel as number;
      const p = clamp((beat - ev.beat) / travel, 0, 1);
      if (p >= 0 && p < 1) drawEnergyCharge(g, ENEMY_X, p, beat);
    }

    // 반격 강타 날아가는 시각 (hold 성공 후)
    for (const ev of r.events) {
      if (ev.kind !== 'hold' || !ev.verdict || ev.verdict === 'miss' || ev.releasedBeat === undefined) continue;
      const p = clamp((beat - ev.releasedBeat) / 0.9, 0, 1);
      if (p < 1) drawSpear(g, PLAYER_X - 60, ENEMY_X + 60, p, true);
    }

    // 적 캐릭터
    const lj = r.lastJudge;
    const enemySince = lj ? beat - lj.atBeat : 99;
    const enemyHitBack = lj?.verdict !== 'miss' && enemySince < 0.7 ? decay(beat, lj!.atBeat, 0.7, 2) : 0;
    const nextHit = nextBeat(r.events, 'hit', beat);
    const enemyWind = windUp(beat, nextHit, 0.4) * 0.5;

    drawCharacter(g, {
      id: ENEMY_ID,
      x: ENEMY_X,
      y: GROUND_Y,
      h: BODY_H,
      squash: enemyHitBack * 0.45,
      hop: enemyHitBack * 16,
      tilt: enemyWind - enemyHitBack * 0.3,
      sing: enemyWind * 0.7,
      blink: idleBlink(beat, 1),
      armR: -enemyWind * 0.8,
    });

    // 플레이어 캐릭터
    const playerSince = lj ? beat - lj.atBeat : 99;
    const hitOk = lj != null && lj.verdict !== 'miss';
    const nextHitP = nextBeat(r.events, 'hit', beat);
    const parryWind = windUp(beat, nextHitP, 0.3);
    const missShake = lj?.verdict === 'miss' && playerSince < 0.5 ? Math.sin(playerSince * 60) * 4 : 0;

    const activeHold = r.events.find(e => e.kind === 'hold' && e.holding);
    const holdDur = activeHold ? (activeHold.endBeat ?? activeHold.beat + 2) - activeHold.beat : 1;
    const holdP = activeHold ? clamp((beat - activeHold.beat) / holdDur, 0, 1) : 0;

    drawCharacter(g, {
      id: PLAYER_ID,
      x: PLAYER_X + missShake,
      y: GROUND_Y,
      h: BODY_H,
      squash: hitOk && lj ? decay(beat, lj.atBeat, 0.45, 2.5) * 0.3 : 0,
      hop: hitOk && playerSince < 0.6 ? easeOut(1 - playerSince / 0.6, 2) * 12 : 0,
      tilt: -parryWind * 0.3 - holdP * 0.4,
      sing: holdP > 0.5 ? holdP * 0.8 : (hitOk && lj ? decay(beat, lj.atBeat, 0.5, 3) * 0.7 : 0),
      blink: idleBlink(beat, 3),
      armL: -parryWind * 0.6 - holdP * 0.9,
      armR: -(parryWind * 0.3 + holdP * 0.6),
    });

    // 막아낸 순간 불꽃
    for (const ev of r.events) {
      if (ev.kind !== 'hit' && ev.kind !== 'hold') continue;
      if (!ev.verdict || ev.verdict === 'miss') continue;
      const atBeat = ev.releasedBeat ?? ev.beat;
      const age = beat - atBeat;
      if (age < 0 || age >= 0.65) continue;
      const sparkX = ev.kind === 'hold' ? ENEMY_X + 70 : (ENEMY_X + 60 + PLAYER_X - 60) / 2;
      shockRing(g, sparkX, GROUND_Y - BODY_H * 0.55, age / 0.65, C.yellow, 58);
    }

    // 반격 게이지
    if (activeHold) drawCounterGauge(g, holdP, beat);

    // 피해 숫자
    for (const ev of r.events) {
      if (ev.kind !== 'hit' && ev.kind !== 'hold') continue;
      if (!ev.verdict || ev.verdict === 'miss') continue;
      const atBeat = ev.releasedBeat ?? ev.beat;
      const age = beat - atBeat;
      if (age < 0 || age >= 1.4) continue;
      const isHold = ev.kind === 'hold';
      const dmg = isHold ? (ev.verdict === 'perfect' ? 25 : 15) : (ev.verdict === 'perfect' ? 10 : 6);
      text(g, `-${dmg}`, ENEMY_X + 20, GROUND_Y - BODY_H * 1.1 - age * 40, {
        size: isHold ? 34 : 22,
        color: C.pink,
        alpha: clamp(1 - age / 1.4, 0, 1),
        weight: 700,
      });
    }

    if (beat < LEAD_IN - 0.5) {
      text(g, '준비...', W / 2, 90, { size: 28, color: C.inkSoft, alpha: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * 창 (spear) 을 fromX → toX 방향으로 그린다.
 * p = 0 → fromX 에 있음, p = 1 → toX 에 있음.
 * isPlayer = true 이면 노란 강타 색으로 그린다.
 */
function drawSpear(
  g: CanvasRenderingContext2D,
  fromX: number,
  toX: number,
  p: number,
  isPlayer: boolean,
): void {
  const x = lerp(fromX, toX, p);
  const y = GROUND_Y - BODY_H * 0.5;
  const dir = toX > fromX ? 1 : -1;

  g.save();
  g.translate(x, y);
  // dir > 0 이면 오른쪽, dir < 0 이면 180° 회전해 왼쪽을 향한다
  if (dir < 0) g.scale(-1, 1);

  // 자루
  g.strokeStyle = '#7B3F1A';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(-46, 0);
  g.stroke();

  // 촉
  g.fillStyle = isPlayer ? C.yellow : C.blue;
  g.strokeStyle = C.ink;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(20, 0);
  g.lineTo(6, -9);
  g.lineTo(0, 0);
  g.lineTo(6, 9);
  g.closePath();
  g.fill();
  g.stroke();

  // 속도 잔상
  g.globalAlpha = 0.3;
  g.strokeStyle = isPlayer ? C.yellow : C.mint;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-50, -5);
  g.lineTo(-82, -5);
  g.moveTo(-50, 5);
  g.lineTo(-74, 5);
  g.stroke();

  g.restore();
}

/** 적이 큰 공격을 준비할 때 나오는 에너지 오라. p = 0→1 로 점점 커지고 밝아진다. */
function drawEnergyCharge(
  g: CanvasRenderingContext2D,
  x: number,
  p: number,
  beat: number,
): void {
  const cy = GROUND_Y - BODY_H * 0.55;
  const pulse = Math.sin(beat * Math.PI * 5) * 8 * p;
  const r = 38 + p * 28 + pulse;

  g.save();
  g.globalAlpha = 0.16 + p * 0.22;
  g.fillStyle = C.yellow;
  circle(g, x, cy, r);
  g.fill();

  g.globalAlpha = 0.5 + p * 0.4;
  g.strokeStyle = C.yellow;
  g.lineWidth = 3 + p * 2;
  circle(g, x, cy, r);
  g.stroke();
  g.restore();
}

/** 적 HP 바. 화면 상단 왼쪽에 그린다. */
function drawHpBars(g: CanvasRenderingContext2D, enemyHp: number): void {
  const barW = 200;
  const barH = 18;
  const lx = ENEMY_X - barW / 2;
  const y = 28;

  g.save();

  // 배경
  g.fillStyle = 'rgba(43,42,51,0.35)';
  roundRect(g, lx - 2, y - 2, barW + 4, barH + 4, 5);
  g.fill();

  // HP 채움
  const fc = enemyHp > 0.5 ? C.mint : enemyHp > 0.25 ? C.yellow : C.pink;
  g.fillStyle = fc;
  roundRect(g, lx, y, barW * enemyHp, barH, 4);
  g.fill();

  // 테두리
  g.strokeStyle = C.ink;
  g.lineWidth = 2.5;
  roundRect(g, lx, y, barW, barH, 4);
  g.stroke();

  text(g, '적', lx - 20, y + barH / 2 + 1, { size: 13, color: C.ink, alpha: 0.65 });
  g.restore();
}

/** 반격 게이지. hold 입력 중에 플레이어 캐릭터 위에 표시된다. */
function drawCounterGauge(g: CanvasRenderingContext2D, p: number, beat: number): void {
  const gx = PLAYER_X;
  const gy = GROUND_Y - BODY_H - 30;
  const barW = 120;
  const barH = 16;
  const near = p > 0.85 && p < 1.1;
  const fc = near ? C.pink : p > 0.6 ? C.yellow : C.mint;

  g.save();

  g.fillStyle = 'rgba(43,42,51,0.3)';
  roundRect(g, gx - barW / 2 - 2, gy - 2, barW + 4, barH + 4, 5);
  g.fill();

  g.fillStyle = fc;
  roundRect(g, gx - barW / 2, gy, barW * clamp(p, 0, 1), barH, 4);
  g.fill();

  // 목표선
  g.save();
  g.strokeStyle = near ? C.pink : C.ink;
  g.lineWidth = near ? 3 : 2;
  g.setLineDash([6, 4]);
  g.beginPath();
  g.moveTo(gx + barW / 2, gy);
  g.lineTo(gx + barW / 2, gy + barH);
  g.stroke();
  g.setLineDash([]);
  g.restore();

  g.strokeStyle = C.ink;
  g.lineWidth = 2.5;
  roundRect(g, gx - barW / 2, gy, barW, barH, 4);
  g.stroke();

  const pulse = near ? Math.sin(beat * Math.PI * 6) * 0.2 : 0;
  text(g, '반격', gx, gy - 10, {
    size: 13,
    color: near ? C.pink : C.inkSoft,
    alpha: 0.8 + pulse,
  });

  g.restore();
}
