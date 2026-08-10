import type { AudioEngine } from '../core/AudioEngine';
import { C, W, circle, clamp, easeOut, lerp, roundRect, text } from '../core/draw';
import type { Difficulty } from '../core/difficulty';
import { makeRng, type Rng } from '../core/rng';
import { type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';
import { PREVIEW_H, PREVIEW_W, type Control } from './howto';
import { drawBackdrop } from './stage';

/**
 * 풍선 불기 — 누르고 있으면 커진다. 터지기 전에 떼야 점수가 된다.
 *
 * **터지는 크기를 처음부터 알려준다.** 예전에는 숨겨 뒀는데, 그러면 잘한 판과
 * 운 좋은 판이 구별되지 않았다 — 60에서 뗐는데 한계가 62여서 대박, 65여서 쪽박.
 * 실력이 아니라 주사위다.
 *
 * 숫자를 보여줘도 게임은 안 쉬워진다. 사람이 0.4초에 100까지 차오르는 눈금을
 * 보고 정확히 73에서 손을 떼는 건 어차피 불가능하기 때문이다. 다만 **실패했을 때
 * 내가 뭘 잘못했는지 알 수 있게** 된다 — 욕심을 부렸는지, 손이 늦었는지.
 *
 * 한계에 아주 가깝게 붙이면 보너스가 붙는다. "안전하게 절반만" 이 최선이 되지
 * 않도록, 아슬아슬한 쪽에 실제로 값을 매긴다.
 */

/** 한계 코앞에서 떼면 붙는 보너스와, 그 인정 폭(0~1 크기 기준). */
const CLUTCH_BAND = 0.05;
const CLUTCH_BONUS = 30;
/** 뗀 뒤 다음 풍선까지 쉬는 시간(초). */
const BREAK = 1.0;

interface Params {
  count: number;
  /** 초당 부푸는 양(0~1 기준). 클수록 손을 멈추기 어렵다. */
  rate: number;
  /** 터지는 크기의 범위. */
  limit: [number, number];
  ok: number;
  superb: number;
}

/**
 * 난이도별 조임.
 *
 * 바꾸는 건 부푸는 속도 하나다. 한계를 좁히거나 개수를 늘리는 것보다,
 * "손을 얼마나 빨리 떼야 하는가" 하나만 조이는 쪽이 난이도가 정직하게 오른다.
 */
const PARAMS: Record<Difficulty, Params> = {
  easy: { count: 5, rate: 0.26, limit: [0.55, 1.0], ok: 230, superb: 330 },
  normal: { count: 5, rate: 0.44, limit: [0.45, 1.0], ok: 240, superb: 345 },
  hard: { count: 6, rate: 0.68, limit: [0.38, 1.0], ok: 280, superb: 400 },
};

interface Balloon {
  /** 0~1 크기. */
  size: number;
  /** 이 크기를 넘으면 터진다. 화면에 그대로 보여준다. */
  limit: number;
  popped: boolean;
  /** 확정된 점수. 아직 부는 중이면 null. */
  scored: number | null;
  /** 한계 코앞에서 뗐는지. */
  clutch: boolean;
}

export class BalloonBlow implements FreeGame {
  readonly id = 'balloon';
  readonly title = '풍선 불기';
  readonly hint = '터지는 크기가 보입니다 — 닿기 직전에 손을 떼세요';
  readonly order = 100;
  readonly keys = ['Space'] as const;
  readonly duration = 0; // 다 불면 끝
  readonly controls: readonly Control[] = [
    { keys: ['Space'], label: '누르고 있으면 커집니다' },
    { keys: ['떼기'], label: '터지기 전에 손 떼기' },
  ];
  readonly scoring = '뗀 크기가 곧 점수 · 한계에 붙이면 보너스 · 터지면 0점';

  private p: Params;
  private balloons: Balloon[] = [];
  private rng: Rng;
  private idx = 0;
  private breakLeft = 0;
  private overT = 0;
  private popped = 0;
  private clutches = 0;
  /** 마지막으로 터지거나 확정된 시각 — 연출용. */
  private eventT = -99;
  /**
   * 이번 풍선에서 스페이스를 한 번이라도 뗐는지.
   *
   * 터진 뒤에도 계속 누르고 있으면 다음 풍선이 저절로 부풀기 시작했다.
   * 새 풍선은 반드시 새로 눌러야 시작한다.
   */
  private rearmed = true;

  constructor(difficulty: Difficulty, seed: number) {
    this.p = PARAMS[difficulty];
    this.rng = makeRng(seed);
  }

  start(): void {
    this.balloons = Array.from({ length: this.p.count }, () => ({
      size: 0,
      // 뒤로 갈수록 더 잘 터지게 하지 않는다 — 다섯 번 다 같은 조건이어야
      // "내가 욕심을 부렸다"가 분명해진다.
      limit: lerp(this.p.limit[0], this.p.limit[1], this.rng()),
      popped: false,
      scored: null,
      clutch: false,
    }));
    this.idx = 0;
    this.breakLeft = 0;
    this.overT = 0;
    this.popped = 0;
    this.clutches = 0;
    this.eventT = -99;
    this.rearmed = true;
  }

  private get current(): Balloon | null {
    return this.idx < this.p.count ? this.balloons[this.idx] : null;
  }

  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    if (this.idx >= this.p.count) {
      this.overT += dt;
      return;
    }
    if (this.breakLeft > 0) {
      this.breakLeft -= dt;
      return;
    }

    const b = this.current!;
    const holding = input.down('Space');

    // 앞 풍선에서 이어 누르고 있는 손은 새 풍선을 부풀리지 못한다.
    if (!holding) this.rearmed = true;
    const blowing = holding && this.rearmed;

    if (blowing && b.scored === null && !b.popped) {
      const before = b.size;
      b.size += this.p.rate * dt;
      // 부는 소리 — 커질수록 음이 올라가 크기가 귀로도 들린다.
      if (Math.floor(before * 26) !== Math.floor(b.size * 26)) {
        audio.blip(audio.ctx.currentTime, 240 + b.size * 520, 0.22, 'sine');
      }
      // 한계 코앞에 오면 심장이 뛴다.
      if (before < b.limit - CLUTCH_BAND && b.size >= b.limit - CLUTCH_BAND) {
        audio.kick(audio.ctx.currentTime, 0.8);
      }
      if (b.size >= b.limit) {
        b.popped = true;
        b.scored = 0;
        this.popped++;
        this.eventT = t;
        audio.bad(audio.ctx.currentTime);
        audio.snare(audio.ctx.currentTime, 1.2);
        // 풍선이 있던 자리에서 사방으로 조각이 튄다.
        input.burst(W / 2, 250, [C.pink, C.blue, C.white], {
          count: 34, speed: [220, 520], size: [3, 8],
        });
        input.shake(14);
        this.finish(t);
      }
      return;
    }

    // 손을 뗐다 — 크기가 그대로 점수가 된다. 조금이라도 불었어야 인정.
    if (!holding && b.size > 0.02 && b.scored === null && !b.popped) {
      b.clutch = b.size >= b.limit - CLUTCH_BAND;
      b.scored = Math.round(b.size * 100) + (b.clutch ? CLUTCH_BONUS : 0);
      if (b.clutch) this.clutches++;
      this.eventT = t;
      audio.good(audio.ctx.currentTime);
      if (b.clutch) {
        audio.blip(audio.ctx.currentTime + 0.12, 1567.98, 0.7, 'triangle');
        input.burst(W / 2, 250, [C.yellow, C.white], {
          count: 20, speed: [120, 300], size: [3, 6], square: true,
        });
        input.shake(5);
      }
      this.finish(t);
    }
  }

  private finish(_t: number): void {
    this.breakLeft = BREAK;
    this.idx++;
    this.rearmed = false;
  }

  get done(): boolean {
    return this.idx >= this.p.count && this.overT > 1.3;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    drawBackdrop(g, t);

    const b = this.current;
    const active = b !== null && this.breakLeft <= 0;
    const shakeAge = t - this.eventT;

    // 캐릭터가 먼저 — 풍선이 그 위로 올라온다.
    drawCharacter(g, {
      id: CAST[2],
      x: W / 2,
      y: 502,
      h: 100,
      sing: active ? clamp(b!.size * 2, 0, 1) : 0,
      squash: shakeAge < 0.3 ? easeOut(1 - shakeAge / 0.3, 2) * 0.4 : 0,
    });

    if (active) this.drawBalloon(g, b!, t);
    else if (this.idx >= this.p.count) text(g, '끝!', W / 2, 250, { size: 40, color: C.mint });
    else this.drawBreak(g);

    this.drawTargetGauge(g, b, active);
    this.drawScore(g);
    this.drawDots(g);
  }

  private drawBalloon(g: CanvasRenderingContext2D, b: Balloon, t: number): void {
    // 한계까지 얼마나 남았는지가 곧 위험도. 숫자를 보여주므로 색·흔들림은
    // "지금 당장 떼야 한다"는 몸의 신호 역할만 한다.
    const danger = clamp(1 - (b.limit - b.size) / 0.22, 0, 1);
    const ox = Math.sin(t * 34) * danger * 6;
    const r = 26 + b.size * 128;

    g.save();
    g.translate(ox, 0);
    // 주둥이부터 — 풍선 뒤로 가도록 먼저 긋는다.
    g.strokeStyle = C.ink;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(W / 2, 250);
    g.lineTo(W / 2, 420);
    g.stroke();

    g.fillStyle = danger > 0.55 ? C.pink : C.blue;
    circle(g, W / 2, 250, r);
    g.fill();
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = C.white;
    circle(g, W / 2 - r * 0.32, 250 - r * 0.34, r * 0.22);
    g.fill();
    g.restore();
    g.restore();

    text(g, `${Math.round(b.size * 100)}`, W / 2 + ox, 250, { size: 38, color: C.white });

    // 보너스 구간에 들어오면 풍선 둘레가 금빛으로 뛴다.
    if (b.size >= b.limit - CLUTCH_BAND) {
      g.save();
      g.globalAlpha = 0.5 + Math.sin(t * 22) * 0.5;
      g.strokeStyle = C.yellow;
      g.lineWidth = 6;
      circle(g, W / 2 + ox, 250, r + 8);
      g.stroke();
      g.restore();
      text(g, '지금!', W / 2 + ox, 250 - r - 26, { size: 24, color: C.yellow, weight: 900 });
    }
  }

  private drawBreak(g: CanvasRenderingContext2D): void {
    const prev = this.balloons[this.idx - 1];
    const label = prev?.popped ? '터졌다!' : prev?.clutch ? '아슬아슬!' : '좋아!';
    text(g, label, W / 2, 250, {
      size: 38,
      color: prev?.popped ? C.pink : prev?.clutch ? C.yellow : C.mint,
      weight: 900,
    });
    if (prev && !prev.popped) {
      text(g, `${prev.scored}점 (한계 ${Math.round(prev.limit * 100)})`, W / 2, 292, {
        size: 17,
        color: C.inkSoft,
        weight: 700,
      });
    } else if (prev) {
      text(g, `한계는 ${Math.round(prev.limit * 100)} 이었습니다`, W / 2, 292, {
        size: 17,
        color: C.inkSoft,
        weight: 700,
      });
    }
  }

  /**
   * 터지는 크기와 지금 크기를 나란히 보여주는 눈금.
   *
   * 숫자만 크게 띄우면 "73"이 얼마나 큰 건지 감이 안 온다. 막대에 한계선을
   * 그어 두면 남은 거리가 길이로 보여서, 숫자를 읽지 않고도 손이 반응한다.
   */
  private drawTargetGauge(
    g: CanvasRenderingContext2D,
    b: Balloon | null,
    active: boolean,
  ): void {
    if (!b) return;
    const bw = 420;
    const x = W / 2 - bw / 2;
    const y = 128;

    g.fillStyle = 'rgba(43, 42, 51, 0.1)';
    roundRect(g, x, y, bw, 14, 7);
    g.fill();

    if (active) {
      g.fillStyle = b.size >= b.limit - CLUTCH_BAND ? C.yellow : C.blue;
      roundRect(g, x, y, bw * clamp(b.size, 0, 1), 14, 7);
      g.fill();
    }

    // 보너스 구간을 띠로 먼저 칠하고, 그 끝에 한계선을 세운다.
    const limX = x + bw * b.limit;
    g.save();
    g.globalAlpha = 0.3;
    g.fillStyle = C.yellow;
    g.fillRect(x + bw * (b.limit - CLUTCH_BAND), y, bw * CLUTCH_BAND, 14);
    g.restore();

    g.strokeStyle = C.pink;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(limX, y - 10);
    g.lineTo(limX, y + 24);
    g.stroke();

    text(g, `터짐 ${Math.round(b.limit * 100)}`, limX, y - 24, {
      size: 16,
      color: C.pink,
      weight: 900,
    });
    text(g, '0', x - 14, y + 7, { size: 12, color: C.inkSoft, weight: 700 });
    text(g, '100', x + bw + 18, y + 7, { size: 12, color: C.inkSoft, weight: 700 });
  }

  private drawScore(g: CanvasRenderingContext2D): void {
    const total = this.balloons.reduce((s, x) => s + (x.scored ?? 0), 0);
    text(g, `${total}`, W - 30, 46, { size: 40, color: C.ink, align: 'right' });
    text(g, '점', W - 30, 74, { size: 13, color: C.inkSoft, align: 'right', weight: 700 });
  }

  /** 풍선 진행 상황 — 몇 번째인지도 여기서 읽힌다. */
  private drawDots(g: CanvasRenderingContext2D): void {
    const n = this.p.count;
    const gap = 62;
    const first = W / 2 - (gap * (n - 1)) / 2;
    for (let i = 0; i < n; i++) {
      const one = this.balloons[i];
      const x = first + i * gap;
      const active = i === this.idx && this.breakLeft <= 0;
      if (one.popped) {
        text(g, '펑', x, 522, { size: 17, color: C.inkSoft, weight: 800 });
      } else if (one.scored !== null) {
        g.fillStyle = one.clutch ? C.yellow : C.mint;
        circle(g, x, 518, 12);
        g.fill();
        text(g, `${one.scored}`, x, 522, { size: 12, color: C.white, weight: 800 });
      } else {
        g.fillStyle = active ? C.pink : 'rgba(43, 42, 51, 0.14)';
        circle(g, x, 518, active ? 12 : 9);
        g.fill();
      }
    }
  }

  result(): FreeResult {
    const total = this.balloons.reduce((s, x) => s + (x.scored ?? 0), 0);
    const kept = this.p.count - this.popped;
    return {
      score: total,
      rank: total >= this.p.superb ? 'superb' : total >= this.p.ok ? 'ok' : 'again',
      headline: `${total}점 (${kept} / ${this.p.count}개 성공)`,
      rows: [
        { label: '합계', value: total, color: C.mint },
        { label: '살린 풍선', value: kept, color: C.blue },
        { label: '아슬아슬', value: this.clutches, color: C.yellow },
        { label: '터뜨림', value: this.popped, color: C.pink },
      ],
    };
  }

  /** 설명 그림 — 눈금이 한계선까지 차오르다가 직전에 멈춘다. */
  preview(g: CanvasRenderingContext2D, t: number): void {
    const limit = 0.72;
    const cycle = 2.6;
    const u = (t % cycle) / cycle;
    // 앞 70% 동안 부풀고, 한계 직전에 멈춰서 남은 시간 동안 그대로 있는다.
    const size = u < 0.7 ? Math.min((u / 0.7) * (limit - 0.03), limit - 0.03) : limit - 0.03;
    const held = u >= 0.7;

    const bw = 360;
    const x = PREVIEW_W / 2 - bw / 2;
    const y = 40;

    g.fillStyle = 'rgba(43, 42, 51, 0.1)';
    roundRect(g, x, y, bw, 14, 7);
    g.fill();
    g.fillStyle = held ? C.yellow : C.blue;
    roundRect(g, x, y, bw * size, 14, 7);
    g.fill();

    const limX = x + bw * limit;
    g.strokeStyle = C.pink;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(limX, y - 10);
    g.lineTo(limX, y + 24);
    g.stroke();
    text(g, `터짐 ${Math.round(limit * 100)}`, limX, y - 22, {
      size: 14,
      color: C.pink,
      weight: 900,
    });

    const r = 14 + size * 52;
    g.fillStyle = held ? C.yellow : C.blue;
    circle(g, PREVIEW_W / 2, 128, r);
    g.fill();
    text(g, `${Math.round(size * 100)}`, PREVIEW_W / 2, 128, { size: 20, color: C.white });

    text(g, held ? '여기서 손을 뗀다' : '누르고 있으면 커진다', PREVIEW_W / 2, PREVIEW_H - 18, {
      size: 14,
      color: held ? C.pink : C.inkSoft,
      weight: 800,
    });
  }
}
