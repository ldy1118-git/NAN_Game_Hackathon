import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, circle, clamp, easeOut, lerp, roundRect, text } from '../core/draw';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';

/**
 * 피하기 — 떨어지는 것을 좌우로 움직여 피한다. 오래 버틸수록 점수.
 *
 * 두더지 잡기가 "정확한 한 번"이라면 이건 "계속 누르고 있기"다. 조작의 성격이
 * 달라야 미니게임 모음이 다채로워진다.
 *
 * 세 번 맞으면 끝. 목숨을 둬야 한 번 실수했다고 포기하지 않는다.
 */

const DURATION = 45;
const GROUND_Y = 470;
const PLAYER_H = 96;
const PLAYER_W = 52;
const SPEED = 430;
const LIVES = 3;

/** 떨어지는 것의 반지름과 낙하 속도(초당). 시간이 지날수록 빨라진다. */
const FALL_START = 210;
const FALL_END = 470;
const SPAWN_START = 0.62;
const SPAWN_END = 0.24;
/** 맞은 직후 무적 시간(초). 연속으로 깎이는 걸 막는다. */
const INVULN = 1.1;

interface Drop {
  x: number;
  y: number;
  vy: number;
  r: number;
  /** 흔들리는 폭. 0 이면 곧게 떨어진다. */
  sway: number;
  seed: number;
  gone: boolean;
}

export class DodgeRain implements FreeGame {
  readonly id = 'dodgerain';
  readonly title = '피하기';
  readonly hint = '떨어지는 걸 피하세요 — ← → 로 이동';
  readonly order = 70;
  readonly keys = ['ArrowLeft', 'ArrowRight'] as const;
  readonly duration = DURATION;

  private x = W / 2;
  private drops: Drop[] = [];
  private nextSpawn = 0.7;
  private lives = LIVES;
  private hitAt = -99;
  private survived = 0;
  private dodged = 0;
  private seed = 7654321;
  private facing = 1;

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  start(): void {
    this.x = W / 2;
    this.drops = [];
    this.nextSpawn = 0.7;
    this.lives = LIVES;
    this.hitAt = -99;
    this.survived = 0;
    this.dodged = 0;
  }

  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    this.survived = t;
    const p = clamp(t / DURATION, 0, 1);

    // 이동 — 누르고 있는 동안 계속. 화면 밖으로는 못 나간다.
    let dir = 0;
    if (input.down('ArrowLeft')) dir -= 1;
    if (input.down('ArrowRight')) dir += 1;
    if (dir !== 0) this.facing = dir;
    this.x = clamp(this.x + dir * SPEED * dt, PLAYER_W / 2 + 8, W - PLAYER_W / 2 - 8);

    // 생성
    if (t >= this.nextSpawn) {
      const r = 16 + this.rand() * 12;
      this.drops.push({
        x: r + this.rand() * (W - r * 2),
        y: -r,
        vy: lerp(FALL_START, FALL_END, p) * (0.85 + this.rand() * 0.3),
        r,
        // 뒤로 갈수록 흔들리며 떨어지는 것이 섞인다.
        sway: this.rand() < 0.25 + p * 0.3 ? 40 + this.rand() * 50 : 0,
        seed: this.rand() * 100,
        gone: false,
      });
      this.nextSpawn = t + lerp(SPAWN_START, SPAWN_END, p) * (0.7 + this.rand() * 0.6);
    }

    const invuln = t - this.hitAt < INVULN;

    for (const d of this.drops) {
      if (d.gone) continue;
      d.y += d.vy * dt;
      const dx = d.sway === 0 ? 0 : Math.sin((d.y / 90) + d.seed) * d.sway;
      const cx = clamp(d.x + dx, d.r, W - d.r);

      // 충돌 — 캐릭터를 사각형으로 보고 원과 겹치는지 본다.
      const top = GROUND_Y - PLAYER_H;
      const nearX = clamp(cx, this.x - PLAYER_W / 2, this.x + PLAYER_W / 2);
      const nearY = clamp(d.y, top, GROUND_Y);
      const hit = (cx - nearX) ** 2 + (d.y - nearY) ** 2 < d.r * d.r;

      if (hit && !invuln) {
        d.gone = true;
        this.lives--;
        this.hitAt = t;
        audio.bad(audio.ctx.currentTime);
        continue;
      }
      if (d.y - d.r > H) {
        d.gone = true;
        this.dodged++;
        // 잘 피한 건 조용히 지나간다 — 매번 소리가 나면 시끄럽다.
      }
    }

    this.drops = this.drops.filter((d) => !d.gone);
  }

  get done(): boolean {
    return this.lives <= 0;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = C.bgDeep;
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    for (const d of this.drops) {
      const dx = d.sway === 0 ? 0 : Math.sin((d.y / 90) + d.seed) * d.sway;
      const cx = clamp(d.x + dx, d.r, W - d.r);
      // 흔들리며 떨어지는 것은 색으로 구분한다 — 예측이 어려우니 미리 알려준다.
      g.fillStyle = d.sway === 0 ? C.blue : C.yellow;
      circle(g, cx, d.y, d.r);
      g.fill();
      g.save();
      g.globalAlpha = 0.25;
      g.fillStyle = C.ink;
      circle(g, cx, d.y - d.r * 0.3, d.r * 0.4);
      g.fill();
      g.restore();
    }

    // 맞은 직후에는 깜빡인다.
    const since = t - this.hitAt;
    const blink = since < INVULN ? (Math.floor(since * 12) % 2 === 0 ? 0.35 : 1) : 1;
    drawCharacter(g, {
      id: CAST[0],
      x: this.x,
      y: GROUND_Y,
      h: PLAYER_H,
      flip: this.facing < 0,
      tilt: this.facing * 0.06,
      alpha: blink,
      squash: since < 0.3 ? easeOut(1 - since / 0.3, 2) * 0.35 : 0,
    });

    // 목숨
    for (let i = 0; i < LIVES; i++) {
      const on = i < this.lives;
      g.save();
      g.globalAlpha = on ? 1 : 0.2;
      g.fillStyle = C.pink;
      roundRect(g, 24 + i * 26, 44, 18, 18, 5);
      g.fill();
      g.restore();
    }

    text(g, `${Math.floor(this.survived)}초`, W / 2, 78, { size: 40, color: C.ink });
  }

  result(): FreeResult {
    const sec = Math.floor(this.survived);
    return {
      score: sec * 10 + this.dodged,
      rank: rankByScore(sec, 20, 40),
      headline: `${sec}초 버팀`,
      rows: [
        { label: '버틴 시간', value: `${sec}초`, color: C.mint },
        { label: '피한 것', value: this.dodged, color: C.blue },
        { label: '남은 목숨', value: Math.max(0, this.lives), color: C.pink },
      ],
    };
  }
}
