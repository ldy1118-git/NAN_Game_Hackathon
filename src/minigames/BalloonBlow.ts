import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, circle, clamp, easeOut, lerp, text } from '../core/draw';
import { type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';

/**
 * 풍선 불기 — 누르고 있으면 커진다. 터지기 전에 떼야 점수가 된다.
 *
 * 다른 게임들은 "빨리·정확히"를 묻지만 이건 **얼마나 욕심을 내느냐**를 묻는다.
 * 목표선이 없다. 언제 떼든 자유고, 크게 불수록 점수가 가파르게 오른다.
 *
 * 터지는 지점은 풍선마다 다르고 미리 알 수 없다. 대신 **위험 구간에 들어가면
 * 소리와 흔들림으로 알려준다** — 정보 없이 터지면 억울하고, 알면서도 못 참는 게 재밌다.
 *
 * 5개를 분다. 터진 풍선은 0점이니 "적당히 크게"를 다섯 번 반복하는 게 최선이다.
 */

const DURATION = 0; // 5개를 다 불면 끝
const COUNT = 5;
/** 초당 부푸는 양(0~1 기준). */
const BLOW_RATE = 0.42;
/** 터질 수 있는 최소·최대 크기. 이 사이 어딘가에서 터진다. */
const POP_MIN = 0.45;
const POP_MAX = 1.0;
/** 이 크기부터 위험 신호를 준다. */
const DANGER = 0.4;
/** 뗀 뒤 다음 풍선까지 쉬는 시간(초). */
const BREAK = 1.0;

interface Balloon {
  /** 0~1 크기. */
  size: number;
  /** 이 크기를 넘으면 터진다. 플레이어에게는 안 보인다. */
  limit: number;
  popped: boolean;
  /** 확정된 점수. 아직 부는 중이면 null. */
  scored: number | null;
}

export class BalloonBlow implements FreeGame {
  readonly id = 'balloon';
  readonly title = '풍선 불기';
  readonly hint = '스페이스를 누르고 있다가 터지기 전에 떼세요 — 5개';
  readonly order = 100;
  readonly keys = ['Space'] as const;
  readonly duration = DURATION;

  private balloons: Balloon[] = [];
  private idx = 0;
  private breakLeft = 0;
  private overT = 0;
  private popped = 0;
  private seed = 987654;
  /** 마지막으로 터지거나 확정된 시각 — 연출용. */
  private eventT = -99;

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  start(): void {
    this.balloons = Array.from({ length: COUNT }, () => ({
      size: 0,
      // 뒤로 갈수록 조금씩 더 잘 터지게 하지 않는다 — 5번 다 같은 조건이어야
      // "내가 욕심을 부렸다"가 분명해진다.
      limit: lerp(POP_MIN, POP_MAX, this.rand()),
      popped: false,
      scored: null,
    }));
    this.idx = 0;
    this.breakLeft = 0;
    this.overT = 0;
    this.popped = 0;
    this.eventT = -99;
  }

  private get current(): Balloon | null {
    return this.idx < COUNT ? this.balloons[this.idx] : null;
  }

  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    if (this.idx >= COUNT) {
      this.overT += dt;
      return;
    }
    if (this.breakLeft > 0) {
      this.breakLeft -= dt;
      return;
    }

    const b = this.current!;
    const blowing = input.down('Space');

    if (blowing && b.scored === null && !b.popped) {
      const before = b.size;
      b.size += BLOW_RATE * dt;
      // 부는 소리 — 커질수록 음이 올라가 크기가 귀로도 들린다.
      if (Math.floor(before * 26) !== Math.floor(b.size * 26)) {
        audio.blip(audio.ctx.currentTime, 240 + b.size * 520, 0.22, 'sine');
      }
      if (b.size >= b.limit) {
        b.popped = true;
        b.scored = 0;
        this.popped++;
        this.eventT = t;
        audio.bad(audio.ctx.currentTime);
        audio.snare(audio.ctx.currentTime, 1.2);
        this.breakLeft = BREAK;
        this.idx++;
      }
      return;
    }

    // 손을 뗐다 — 크기가 그대로 점수가 된다. 조금이라도 불었어야 인정.
    if (!blowing && b.size > 0.02 && b.scored === null && !b.popped) {
      b.scored = Math.round(b.size * 100);
      this.eventT = t;
      audio.good(audio.ctx.currentTime);
      this.breakLeft = BREAK;
      this.idx++;
    }
  }

  get done(): boolean {
    return this.idx >= COUNT && this.overT > 1.3;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    const b = this.current;
    const blowing = b !== null && this.breakLeft <= 0;
    const shakeAge = t - this.eventT;

    // 캐릭터가 먼저 — 풍선이 그 위로 올라온다.
    drawCharacter(g, {
      id: CAST[2],
      x: W / 2,
      y: 502,
      h: 100,
      sing: blowing ? clamp(b!.size * 2, 0, 1) : 0,
      squash: shakeAge < 0.3 ? easeOut(1 - shakeAge / 0.3, 2) * 0.4 : 0,
    });

    if (blowing) {
      const danger = clamp((b!.size - DANGER) / (POP_MAX - DANGER), 0, 1);
      // 위험할수록 흔들린다 — 터지기 전에 몸으로 알 수 있어야 억울하지 않다.
      const ox = Math.sin(t * 34) * danger * 5;
      const r = 26 + b!.size * 128;

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

      text(g, `${Math.round(b!.size * 100)}`, W / 2 + ox, 250, { size: 34, color: C.white });
    } else if (this.idx >= COUNT) {
      text(g, '끝!', W / 2, 250, { size: 40, color: C.mint });
    } else {
      // 쉬는 동안에는 풍선 자리가 비므로 결과를 크게 띄운다.
      const prev = this.balloons[this.idx - 1];
      text(g, prev?.popped ? '터졌다!' : '좋아!', W / 2, 250, {
        size: 38,
        color: prev?.popped ? C.pink : C.mint,
        weight: 900,
      });
    }

    // 점수는 오른쪽 위 — 풍선이 최대로 커져도 안 가린다.
    const total = this.balloons.reduce((s, x) => s + (x.scored ?? 0), 0);
    text(g, `${total}`, W - 30, 46, { size: 40, color: C.ink, align: 'right' });
    text(g, '점', W - 30, 74, { size: 13, color: C.inkSoft, align: 'right', weight: 700 });

    // 풍선 다섯 개의 진행 상황 — 몇 번째인지도 여기서 읽힌다.
    const gap = 62;
    const first = W / 2 - (gap * (COUNT - 1)) / 2;
    for (let i = 0; i < COUNT; i++) {
      const one = this.balloons[i];
      const x = first + i * gap;
      const active = i === this.idx && this.breakLeft <= 0;
      if (one.popped) {
        text(g, '펑', x, 522, { size: 17, color: C.inkSoft, weight: 800 });
      } else if (one.scored !== null) {
        g.fillStyle = C.mint;
        circle(g, x, 518, 11);
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
    const kept = COUNT - this.popped;
    return {
      score: total,
      rank: total >= 300 ? 'superb' : total >= 160 ? 'ok' : 'again',
      headline: `${total}점 (${kept} / ${COUNT}개 성공)`,
      rows: [
        { label: '합계', value: total, color: C.mint },
        { label: '살린 풍선', value: kept, color: C.blue },
        { label: '터뜨림', value: this.popped, color: C.pink },
      ],
    };
  }
}
