import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, clamp, easeOut, lerp, roundRect, text } from '../core/draw';
import type { Difficulty } from '../core/difficulty';
import { makeRng, range } from '../core/rng';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';
import { PREVIEW_W, type Control } from './howto';
import { drawBackdrop } from './stage';

/**
 * 연타 달리기 — 스페이스를 두드려 상대보다 먼저 결승선에 닿는다.
 *
 * 두더지가 정확도, 피하기가 지속 조작이라면 이건 순수한 연타다. 셋의 조작이
 * 겹치지 않아야 모음이 지루해지지 않는다.
 *
 * 상대는 **일정한 속도로** 달린다. 승부가 갈리는 지점을 정확히 알 수 있어야
 * "조금만 더"가 생긴다 — 상대가 난수로 빨라졌다 느려졌다 하면, 진 이유가
 * 내 손이 아니라 운이 되어 버린다.
 *
 * 대신 상대의 목표 기록은 판마다 조금씩 다르다(±0.6초). 매번 똑같은 10.0초를
 * 상대하면 한 번 이긴 뒤로는 같은 판을 반복하는 셈이 되기 때문이다.
 */

const TRACK_LEFT = 90;
const TRACK_RIGHT = W - 120;
const LANE_Y = [250, 400] as const;

/**
 * 한 번 누를 때 나아가는 거리(0~1 비율).
 *
 * 사람이 마구 두드리면 초당 7~9번쯤이 한계다. 그 언저리에서 승부가 갈리도록 맞췄다.
 *   초당 6번 → 13초 · 초당 8번 → 8.5초 · 초당 10번 → 6.3초
 */
const STEP = 0.021;
/** 안전장치 — 아무리 못해도 이 시간이면 끝낸다. */
const HARD_LIMIT = 40;

interface Params {
  /** 상대의 완주 시간(초) 범위. 이 안에서 판마다 하나 뽑는다. */
  rivalSec: [number, number];
  /** 가만히 있으면 뒤로 밀리는 속도(초당 비율). 연타를 멈추면 손해다. */
  drag: number;
  /** '완벽' 이 되는 내 기록(초). 이보다 빨리 골인해야 한다. */
  superbSec: number;
}

/**
 * 난이도별 조임.
 *
 * 쉬움의 상대는 14초 — 초당 3.5번만 눌러도 이긴다. 이기는 맛을 먼저 보고,
 * 그 다음에 "얼마나 빨리"로 넘어가게 한다.
 */
const PARAMS: Record<Difficulty, Params> = {
  easy: { rivalSec: [13.4, 14.6], drag: 0.02, superbSec: 10.5 },
  normal: { rivalSec: [10.6, 11.4], drag: 0.05, superbSec: 8.6 },
  hard: { rivalSec: [8.6, 9.2], drag: 0.09, superbSec: 7.2 },
};

export class TugRace implements FreeGame {
  readonly id = 'tugrace';
  readonly title = '연타 달리기';
  /** 상대 기록이 판마다 달라서 생성자에서 만든다. */
  readonly hint: string;
  readonly order = 80;
  readonly keys = ['Space'] as const;
  readonly duration = 0; // 결승선에 닿으면 끝. 제한 시간 없음
  readonly controls: readonly Control[] = [
    { keys: ['Space'], label: '두드릴수록 앞으로' },
  ];
  readonly scoring = '상대보다 먼저 결승선 · 빨리 들어올수록 높은 점수';

  private p: Params;
  /** 이 판 상대의 완주 시간(초). */
  private rivalSec: number;
  private rivalSpeed: number;

  /** 0~1 진행도. */
  private me = 0;
  private rival = 0;
  private taps = 0;
  private finishedAt: number | null = null;
  private won = false;
  private lastTapT = -99;
  private overT = 0;

  constructor(difficulty: Difficulty, seed: number) {
    this.p = PARAMS[difficulty];
    const rng = makeRng(seed);
    this.rivalSec = range(rng, this.p.rivalSec[0], this.p.rivalSec[1]);
    this.rivalSpeed = 1 / this.rivalSec;
    this.hint = `스페이스를 마구 두드려 먼저 골인 — 상대는 ${this.rivalSec.toFixed(1)}초`;
  }

  start(): void {
    this.me = 0;
    this.rival = 0;
    this.taps = 0;
    this.finishedAt = null;
    this.won = false;
    this.lastTapT = -99;
    this.overT = 0;
  }

  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    if (this.finishedAt !== null) {
      // 결승선 통과 후 잠깐 보여주고 끝낸다.
      this.overT += dt;
      return;
    }

    if (input.pressed('Space')) {
      this.taps++;
      this.me = clamp(this.me + STEP, 0, 1);
      this.lastTapT = t;
      // 발소리 — 나아갈수록 높아져서 속도가 귀로도 느껴진다.
      audio.blip(audio.ctx.currentTime, 220 + this.me * 300, 0.32, 'square');
      if (this.taps % 8 === 0) audio.kick(audio.ctx.currentTime, 0.5);
    } else {
      this.me = clamp(this.me - this.p.drag * dt, 0, 1);
    }

    this.rival = clamp(this.rival + this.rivalSpeed * dt, 0, 1);

    if (this.me >= 1 || this.rival >= 1 || t >= HARD_LIMIT) {
      this.won = this.me >= 1 && this.me >= this.rival;
      this.finishedAt = t;
      const now = audio.ctx.currentTime;
      if (this.won) {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          audio.blip(now + i * 0.08, f, 0.9, 'triangle'),
        );
        input.burst(TRACK_RIGHT, LANE_Y[0] - 30, [C.pink, C.yellow, C.mint, C.white], {
          count: 36, speed: [180, 460], size: [3, 8], square: true,
        });
        input.shake(9);
      } else {
        audio.bad(now);
        input.shake(6);
      }
    }
  }

  get done(): boolean {
    // 결승 연출을 1.2초 보여준 뒤 결과 화면으로.
    return this.finishedAt !== null && this.overT > 1.2;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    drawBackdrop(g, t);

    for (let lane = 0; lane < 2; lane++) {
      const y = LANE_Y[lane];
      g.fillStyle = 'rgba(43, 42, 51, 0.06)';
      roundRect(g, TRACK_LEFT, y - 6, TRACK_RIGHT - TRACK_LEFT + 40, 12, 6);
      g.fill();
      g.fillStyle = lane === 0 ? C.pink : C.inkSoft;
      roundRect(g, TRACK_RIGHT + 34, y - 58, 6, 64, 3);
      g.fill();
    }

    const mePos = lerp(TRACK_LEFT, TRACK_RIGHT, this.me);
    const rivalPos = lerp(TRACK_LEFT, TRACK_RIGHT, this.rival);

    // 두드린 직후 몸이 튄다 — 연타가 화면에 즉시 보여야 손이 신난다.
    const since = t - this.lastTapT;
    const bounce = since < 0.14 ? easeOut(1 - since / 0.14, 2) : 0;

    drawCharacter(g, {
      id: CAST[3],
      x: rivalPos,
      y: LANE_Y[1],
      h: 104,
      tilt: 0.05,
      hop: Math.abs(Math.sin(t * 7)) * 9,
    });
    drawCharacter(g, {
      id: CAST[0],
      x: mePos,
      y: LANE_Y[0],
      h: 104,
      tilt: 0.08,
      hop: bounce * 16,
      squash: bounce * 0.3,
    });

    text(g, '나', TRACK_LEFT - 34, LANE_Y[0], { size: 16, color: C.pink, weight: 800 });
    text(g, `상대 ${this.rivalSec.toFixed(1)}초`, TRACK_LEFT - 34, LANE_Y[1], {
      size: 14,
      color: C.inkSoft,
      weight: 700,
    });

    text(g, `${this.taps}`, W / 2, 92, { size: 46, color: C.ink });
    text(g, '번 두드림', W / 2, 126, { size: 14, color: C.inkSoft, weight: 700 });

    if (this.finishedAt === null) {
      const gap = this.me - this.rival;
      const label = gap > 0.02 ? '앞서는 중!' : gap < -0.02 ? '뒤처졌다!' : '나란히!';
      text(g, label, W / 2, H - 60, {
        size: 20,
        color: gap > 0.02 ? C.mint : gap < -0.02 ? C.pink : C.inkSoft,
        weight: 800,
      });
    } else {
      const pop = easeOut(clamp(this.overT / 0.35, 0, 1), 2);
      g.save();
      g.translate(W / 2, H - 66);
      g.scale(pop, pop);
      text(g, this.won ? '골인!' : '졌다...', 0, 0, {
        size: 40,
        color: this.won ? C.mint : C.inkSoft,
      });
      g.restore();
    }
  }

  result(): FreeResult {
    const sec = this.finishedAt ?? HARD_LIMIT;
    // 이기면 남은 여유만큼 점수가 붙는다. 져도 얼마나 근접했는지는 남긴다.
    const score = this.won
      ? 500 + Math.round((this.rivalSec - sec) * 60)
      : Math.round(this.me * 300);
    return {
      score: Math.max(0, score),
      rank: this.won
        ? sec <= this.p.superbSec
          ? 'superb'
          : 'ok'
        : rankByScore(this.me, 2, 3), // 지면 등급을 못 받는다
      headline: this.won ? `${sec.toFixed(1)}초에 골인` : `${Math.round(this.me * 100)}% 지점에서 패배`,
      rows: [
        { label: '두드림', value: this.taps, color: C.mint },
        { label: '기록', value: `${sec.toFixed(1)}초`, color: C.blue },
        { label: '상대', value: `${this.rivalSec.toFixed(1)}초`, color: C.inkSoft },
        { label: '결과', value: this.won ? '승' : '패', color: this.won ? C.pink : C.inkSoft },
      ],
    };
  }

  /** 설명 그림 — 두드릴 때마다 한 칸씩 나아가는 두 주자. */
  preview(g: CanvasRenderingContext2D, t: number): void {
    const left = 70;
    const right = PREVIEW_W - 70;
    const laneY = [78, 148];

    for (let lane = 0; lane < 2; lane++) {
      g.fillStyle = 'rgba(43, 42, 51, 0.07)';
      roundRect(g, left, laneY[lane] - 4, right - left, 8, 4);
      g.fill();
    }
    g.fillStyle = C.pink;
    roundRect(g, right, laneY[0] - 40, 5, 46, 2);
    g.fill();
    g.fillStyle = C.inkSoft;
    roundRect(g, right, laneY[1] - 40, 5, 46, 2);
    g.fill();

    const u = (t % 3) / 3;
    // 나는 계단식으로(두드릴 때마다), 상대는 매끄럽게.
    const taps = Math.floor(u * 22) / 22;
    const bounce = ((u * 22) % 1) < 0.35 ? 1 - ((u * 22) % 1) / 0.35 : 0;

    drawCharacter(g, {
      id: CAST[3],
      x: lerp(left, right, u * 0.82),
      y: laneY[1],
      h: 62,
      tilt: 0.05,
      hop: Math.abs(Math.sin(t * 7)) * 5,
    });
    drawCharacter(g, {
      id: CAST[0],
      x: lerp(left, right, taps),
      y: laneY[0],
      h: 62,
      tilt: 0.08,
      hop: bounce * 10,
      squash: bounce * 0.3,
    });

    text(g, '나', left - 24, laneY[0], { size: 13, color: C.pink, weight: 800 });
    text(g, '상대', left - 24, laneY[1], { size: 13, color: C.inkSoft, weight: 700 });
  }
}
