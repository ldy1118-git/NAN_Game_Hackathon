import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, clamp, easeOut, lerp, roundRect, text } from '../core/draw';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';

/**
 * 연타 달리기 — 스페이스를 두드려 상대보다 먼저 결승선에 닿는다.
 *
 * 두더지가 정확도, 피하기가 지속 조작이라면 이건 순수한 연타다. 셋의 조작이
 * 겹치지 않아야 모음이 지루해지지 않는다.
 *
 * 상대는 일정한 속도로 달린다. 승부가 갈리는 지점을 정확히 알 수 있어야
 * "조금만 더"가 생긴다 — 난수로 흔들면 억울해진다.
 */

const DURATION = 0; // 결승선에 닿으면 끝. 제한 시간 없음
const TRACK_LEFT = 90;
const TRACK_RIGHT = W - 120;
const LANE_Y = [250, 400] as const;

/**
 * 한 번 누를 때 나아가는 거리(0~1 비율).
 *
 * 사람이 마구 두드리면 초당 7~9번쯤이 한계다. 그 언저리에서 승부가 갈리도록 맞췄다.
 *   초당 6번 → 13초  (패)
 *   초당 8번 → 8.5초 (신)
 *   초당 10번 → 6.3초 (여유 있게 승)
 * 상대가 10초이므로 "조금만 더 빨리"가 실제로 결과를 바꾼다.
 */
const STEP = 0.021;
/** 가만히 있으면 뒤로 밀리는 속도(초당 비율). 연타를 멈추면 손해다. */
const DRAG = 0.05;
/** 상대 속도(초당 비율). 1 / 이 값 = 상대의 완주 시간(초). */
const RIVAL_SPEED = 1 / 10;
/** 안전장치 — 아무리 못해도 이 시간이면 끝낸다. */
const HARD_LIMIT = 40;

export class TugRace implements FreeGame {
  readonly id = 'tugrace';
  readonly title = '연타 달리기';
  readonly hint = '스페이스를 마구 두드려 먼저 골인 — 상대는 10초';
  readonly order = 80;
  readonly keys = ['Space'] as const;
  readonly duration = DURATION;

  /** 0~1 진행도. */
  private me = 0;
  private rival = 0;
  private taps = 0;
  private finishedAt: number | null = null;
  private won = false;
  private lastTapT = -99;
  private overT = 0;

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
      this.me = clamp(this.me - DRAG * dt, 0, 1);
    }

    this.rival = clamp(this.rival + RIVAL_SPEED * dt, 0, 1);

    if (this.me >= 1 || this.rival >= 1 || t >= HARD_LIMIT) {
      this.won = this.me >= 1 && this.me >= this.rival;
      this.finishedAt = t;
      const now = audio.ctx.currentTime;
      if (this.won) {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          audio.blip(now + i * 0.08, f, 0.9, 'triangle'),
        );
      } else {
        audio.bad(now);
      }
    }
  }

  get done(): boolean {
    // 결승 연출을 1.2초 보여준 뒤 결과 화면으로.
    return this.finishedAt !== null && this.overT > 1.2;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    for (let lane = 0; lane < 2; lane++) {
      const y = LANE_Y[lane];
      // 트랙
      g.fillStyle = 'rgba(43, 42, 51, 0.06)';
      roundRect(g, TRACK_LEFT, y - 6, TRACK_RIGHT - TRACK_LEFT + 40, 12, 6);
      g.fill();
      // 결승선
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
    text(g, '상대', TRACK_LEFT - 34, LANE_Y[1], { size: 16, color: C.inkSoft, weight: 700 });

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
    const score = this.won ? 500 + Math.round((10 - sec) * 60) : Math.round(this.me * 300);
    return {
      score: Math.max(0, score),
      rank: this.won ? (sec <= 8.5 ? 'superb' : 'ok') : rankByScore(this.me, 0.8, 2),
      headline: this.won ? `${sec.toFixed(1)}초에 골인` : `${Math.round(this.me * 100)}% 지점에서 패배`,
      rows: [
        { label: '두드림', value: this.taps, color: C.mint },
        { label: '기록', value: `${sec.toFixed(1)}초`, color: C.blue },
        { label: '결과', value: this.won ? '승' : '패', color: this.won ? C.pink : C.inkSoft },
      ],
    };
  }
}
