import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, circle, clamp, easeOut, lerp, roundRect, text } from '../core/draw';
import type { Difficulty } from '../core/difficulty';
import { makeRng, range, type Rng } from '../core/rng';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';
import { PREVIEW_H, PREVIEW_W, loop, pingPong, type Control } from './howto';
import { drawBackdrop, drawGround } from './stage';

/**
 * 피하기 — 위에서 떨어지는 것은 옆으로 비키고, 바닥으로 굴러오는 것은 뛰어넘는다.
 *
 * 조작이 둘이라는 게 이 게임의 전부다. 좌우로만 움직이던 때는 화면 한쪽 끝에
 * 붙어 있는 게 늘 최선이라 판이 지루했다. 바닥으로 굴러오는 것을 넣으면 끝에
 * 붙어 있을 수가 없고, 뛰는 동안은 좌우로 못 피하므로 "언제 뛸까"가 계속 걸린다.
 *
 * 굴러오는 것은 보통부터 나온다. 쉬움에서는 떨어지는 것만 보고
 * 좌우 감각을 먼저 익히게 한다.
 *
 * 세 번 맞으면 끝. 목숨을 둬야 한 번 실수했다고 포기하지 않는다.
 */

const GROUND_Y = 470;
const PLAYER_H = 96;
const PLAYER_W = 52;
const SPEED = 400;
const LIVES = 3;

/** 점프. 정점 ~92px, 체공 ~0.66초 — 굴러오는 것(높이 52) 위를 여유 있게 넘는다. */
const JUMP_V = 560;
const GRAVITY = 1700;

/** 맞은 직후 무적 시간(초). 연속으로 깎이는 걸 막는다. */
const INVULN = 1.2;
/** 굴러오는 것이 화면에 들어오기 전에 미리 알려주는 시간(초). */
const WARN_SEC = 0.75;

interface Params {
  duration: number;
  /** 떨어지는 속도(초당) — 시작과 끝. */
  fallStart: number;
  fallEnd: number;
  /** 떨어지는 것의 간격(초) — 시작과 끝. */
  spawnStart: number;
  spawnEnd: number;
  /** 흔들리며 떨어지는 것의 비율. 뒤로 갈수록 여기에 진행도가 더해진다. */
  sway: number;
  /** 굴러오는 것이 처음 나오는 시각(초). Infinity 면 안 나온다. */
  rollerFrom: number;
  /** 굴러오는 것의 간격(초) 범위. */
  rollerGap: [number, number];
  /** 굴러오는 것의 속도(초당) 범위. */
  rollerSpeed: [number, number];
  /** '그럭저럭'·'완벽' 이 되는 생존 시간(초). */
  ok: number;
  superb: number;
}

/**
 * 난이도별 조임.
 *
 * 쉬움은 굴러오는 것이 아예 없다. 조작 하나씩 익히게 하는 편이
 * 처음부터 둘 다 던져 주는 것보다 훨씬 빨리 늘었다.
 */
const PARAMS: Record<Difficulty, Params> = {
  easy: {
    duration: 30,
    fallStart: 140, fallEnd: 220,
    spawnStart: 1.05, spawnEnd: 0.7,
    sway: 0,
    rollerFrom: Infinity, rollerGap: [9, 9], rollerSpeed: [200, 200],
    ok: 16, superb: 27,
  },
  normal: {
    duration: 38,
    fallStart: 170, fallEnd: 290,
    spawnStart: 0.85, spawnEnd: 0.5,
    sway: 0.15,
    rollerFrom: 6, rollerGap: [3.2, 4.6], rollerSpeed: [230, 300],
    ok: 20, superb: 34,
  },
  hard: {
    duration: 45,
    fallStart: 200, fallEnd: 370,
    spawnStart: 0.7, spawnEnd: 0.36,
    sway: 0.3,
    rollerFrom: 2, rollerGap: [2.0, 3.2], rollerSpeed: [300, 400],
    ok: 24, superb: 40,
  },
};

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

interface Roller {
  x: number;
  /** 초당 이동. 양수면 오른쪽으로. */
  vx: number;
  r: number;
  /** 아직 화면 밖에서 예고 중인 동안 남은 시간(초). */
  warn: number;
  gone: boolean;
}

export class DodgeRain implements FreeGame {
  readonly id = 'dodgerain';
  readonly title = '피하기';
  readonly hint = '떨어지는 건 옆으로, 굴러오는 건 점프로';
  readonly order = 70;
  readonly keys = ['ArrowLeft', 'ArrowRight', 'Space'] as const;
  readonly duration: number;
  readonly controls: readonly Control[];
  readonly scoring = '오래 버틸수록 점수 · 세 번 맞으면 끝';

  private p: Params;
  /** 굴러오는 것이 나오는 난이도인가. 안내 문구를 띄울지 판단하는 데 쓴다. */
  private hasRollers: boolean;
  private rng: Rng;

  private x = W / 2;
  /** 발이 바닥에서 뜬 높이(px). 0 이면 서 있다. */
  private jumpY = 0;
  private vy = 0;
  private drops: Drop[] = [];
  private rollers: Roller[] = [];
  private nextSpawn = 0.9;
  private nextRoller = 0;
  private lives = LIVES;
  private hitAt = -99;
  private survived = 0;
  private dodged = 0;
  private jumped = 0;
  private facing = 1;

  constructor(difficulty: Difficulty, seed: number) {
    this.p = PARAMS[difficulty];
    this.duration = this.p.duration;
    this.rng = makeRng(seed);
    this.nextRoller = this.p.rollerFrom;
    // 쉬움에서는 점프를 안 쓴다. 없는 조작을 설명 화면에 띄우면
    // 있지도 않은 위협을 찾게 된다.
    this.hasRollers = Number.isFinite(this.p.rollerFrom);
    this.controls = this.hasRollers
      ? [
          { keys: ['←', '→'], label: '좌우로 피하기' },
          { keys: ['Space'], label: '점프 — 굴러오는 것을 넘기' },
        ]
      : [{ keys: ['←', '→'], label: '좌우로 피하기' }];
  }

  start(): void {
    this.x = W / 2;
    this.jumpY = 0;
    this.vy = 0;
    this.drops = [];
    this.rollers = [];
    this.nextSpawn = 0.9;
    this.nextRoller = this.p.rollerFrom;
    this.lives = LIVES;
    this.hitAt = -99;
    this.survived = 0;
    this.dodged = 0;
    this.jumped = 0;
  }

  private get grounded(): boolean {
    return this.jumpY <= 0;
  }

  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    this.survived = t;
    const p = clamp(t / this.p.duration, 0, 1);

    this.moveSelf(dt, input, audio);
    this.spawn(t, p);
    this.stepDrops(dt, t, audio, input);
    this.stepRollers(dt, t, audio, input);

    this.drops = this.drops.filter((d) => !d.gone);
    this.rollers = this.rollers.filter((r) => !r.gone);
  }

  /** 좌우 이동과 점프. 뜬 동안에도 좌우는 되지만 방향을 크게 바꾸긴 어렵다. */
  private moveSelf(dt: number, input: FreeInput, audio: AudioEngine): void {
    let dir = 0;
    if (input.down('ArrowLeft')) dir -= 1;
    if (input.down('ArrowRight')) dir += 1;
    if (dir !== 0) this.facing = dir;
    // 공중에서는 조금 덜 움직인다 — 뛰는 순간의 판단이 그대로 결과가 되도록.
    const speed = this.grounded ? SPEED : SPEED * 0.72;
    this.x = clamp(this.x + dir * speed * dt, PLAYER_W / 2 + 8, W - PLAYER_W / 2 - 8);

    if (input.pressed('Space') && this.grounded) {
      this.vy = JUMP_V;
      this.jumped++;
      audio.blip(audio.ctx.currentTime, 520, 0.45, 'triangle');
      // 발밑에서 먼지가 옆으로 퍼진다.
      input.burst(this.x, GROUND_Y, [C.inkSoft, C.bgDeep], {
        count: 7, speed: [60, 170], size: [2, 5], angle: Math.PI, spread: Math.PI * 2, gravity: 500,
      });
    }

    if (!this.grounded || this.vy > 0) {
      const wasAir = !this.grounded;
      this.vy -= GRAVITY * dt;
      this.jumpY += this.vy * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.vy = 0;
        // 착지 — 먼지가 낮게 깔린다.
        if (wasAir) {
          input.burst(this.x, GROUND_Y, [C.inkSoft], {
            count: 5, speed: [50, 130], size: [2, 4], gravity: 300,
          });
        }
      }
    }
  }

  private spawn(t: number, p: number): void {
    if (t >= this.nextSpawn) {
      const r = 16 + this.rng() * 12;
      this.drops.push({
        x: r + this.rng() * (W - r * 2),
        y: -r,
        r,
        vy: lerp(this.p.fallStart, this.p.fallEnd, p) * (0.85 + this.rng() * 0.3),
        // 뒤로 갈수록 흔들리며 떨어지는 것이 섞인다.
        sway: this.rng() < this.p.sway + p * 0.25 ? 40 + this.rng() * 50 : 0,
        seed: this.rng() * 100,
        gone: false,
      });
      this.nextSpawn =
        t + lerp(this.p.spawnStart, this.p.spawnEnd, p) * (0.8 + this.rng() * 0.4);
    }

    if (t >= this.nextRoller) {
      const fromLeft = this.rng() < 0.5;
      const r = 22 + this.rng() * 8;
      const speed = range(this.rng, this.p.rollerSpeed[0], this.p.rollerSpeed[1]);
      this.rollers.push({
        x: fromLeft ? -r : W + r,
        vx: fromLeft ? speed : -speed,
        r,
        warn: WARN_SEC,
        gone: false,
      });
      this.nextRoller = t + range(this.rng, this.p.rollerGap[0], this.p.rollerGap[1]);
    }
  }

  private stepDrops(dt: number, t: number, audio: AudioEngine, input: FreeInput): void {
    for (const d of this.drops) {
      if (d.gone) continue;
      d.y += d.vy * dt;
      const cx = dropX(d);

      if (this.overlaps(cx, d.y, d.r)) {
        // 무적 여부는 방울마다 다시 본다. 루프 밖에서 한 번만 재면 같은 프레임에
        // 겹쳐 떨어진 방울들이 전부 명중으로 처리되어 목숨 셋이 한꺼번에 날아간다.
        if (t - this.hitAt >= INVULN) {
          d.gone = true;
          this.takeHit(t, audio, input, cx, d.y, C.blue);
        }
        continue;
      }
      if (d.y - d.r > H) {
        d.gone = true;
        this.dodged++;
        // 잘 피한 건 조용히 지나간다 — 매번 소리가 나면 시끄럽다.
      }
    }
  }

  private stepRollers(dt: number, t: number, audio: AudioEngine, input: FreeInput): void {
    for (const r of this.rollers) {
      if (r.gone) continue;
      // 예고하는 동안에는 아직 굴러오지 않는다.
      if (r.warn > 0) {
        r.warn -= dt;
        continue;
      }
      r.x += r.vx * dt;
      const cy = GROUND_Y - r.r;

      if (this.overlaps(r.x, cy, r.r)) {
        if (t - this.hitAt >= INVULN) {
          r.gone = true;
          this.takeHit(t, audio, input, r.x, cy, C.pink);
        }
        continue;
      }
      if (r.x < -r.r * 2 || r.x > W + r.r * 2) {
        r.gone = true;
        this.dodged++;
      }
    }
  }

  /** 원과 캐릭터 사각형이 겹치는지. 뛴 만큼 사각형이 통째로 올라간다. */
  private overlaps(cx: number, cy: number, r: number): boolean {
    const bottom = GROUND_Y - this.jumpY;
    const top = bottom - PLAYER_H;
    const nearX = clamp(cx, this.x - PLAYER_W / 2, this.x + PLAYER_W / 2);
    const nearY = clamp(cy, top, bottom);
    return (cx - nearX) ** 2 + (cy - nearY) ** 2 < r * r;
  }

  private takeHit(
    t: number, audio: AudioEngine, input: FreeInput,
    x: number, y: number, color: string,
  ): void {
    this.lives--;
    this.hitAt = t;
    audio.bad(audio.ctx.currentTime);
    input.burst(x, y, [color, C.ink, C.white], { count: 20, speed: [150, 380], size: [3, 7] });
    // 마지막 목숨이 날아갈 때 더 크게 흔든다 — 끝났다는 게 몸으로 온다.
    input.shake(this.lives <= 0 ? 16 : 10);
  }

  get done(): boolean {
    return this.lives <= 0;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    drawBackdrop(g, t);
    drawGround(g, t, GROUND_Y);

    for (const d of this.drops) drawDrop(g, d);
    for (const r of this.rollers) drawRoller(g, r, t);

    // 맞은 직후에는 깜빡인다.
    const since = t - this.hitAt;
    const blink = since < INVULN ? (Math.floor(since * 12) % 2 === 0 ? 0.35 : 1) : 1;
    const airborne = this.jumpY > 1;
    drawCharacter(g, {
      id: CAST[0],
      x: this.x,
      y: GROUND_Y,
      h: PLAYER_H,
      hop: this.jumpY,
      flip: this.facing < 0,
      tilt: this.facing * 0.06,
      alpha: blink,
      squash: since < 0.3 ? easeOut(1 - since / 0.3, 2) * 0.35 : 0,
      // 뛰는 동안 팔을 든다. 발이 떠 있다는 게 실루엣만으로 읽혀야 한다.
      armL: airborne ? -0.8 : 0,
      armR: airborne ? -0.8 : 0,
    });

    this.drawHud(g, t);
  }

  private drawHud(g: CanvasRenderingContext2D, t: number): void {
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

    if (this.hasRollers && this.survived < this.p.rollerFrom) {
      const left = this.p.rollerFrom - this.survived;
      if (left < 3) {
        const pulse = 0.5 + Math.sin(t * 8) * 0.5;
        text(g, '곧 바닥에서 굴러옵니다 — 스페이스로 점프!', W / 2, 122, {
          size: 17,
          color: C.pink,
          weight: 800,
          alpha: pulse,
        });
      }
    }
  }

  result(): FreeResult {
    const sec = Math.floor(this.survived);
    return {
      score: sec * 10 + this.dodged,
      rank: rankByScore(sec, this.p.ok, this.p.superb),
      headline: `${sec}초 버팀`,
      rows: [
        { label: '버틴 시간', value: `${sec}초`, color: C.mint },
        { label: '피한 것', value: this.dodged, color: C.blue },
        { label: '점프', value: this.jumped, color: C.yellow },
        { label: '남은 목숨', value: Math.max(0, this.lives), color: C.pink },
      ],
    };
  }

  /** 설명 그림 — 좌우로 움직이다가 굴러오는 것을 뛰어넘는 한 바퀴. */
  preview(g: CanvasRenderingContext2D, t: number): void {
    const gy = PREVIEW_H - 26;
    g.fillStyle = C.bgDeep;
    g.fillRect(0, gy, PREVIEW_W, PREVIEW_H - gy);

    const u = loop(t, 3.2);
    // 앞 절반은 좌우 이동, 뒤 절반은 점프.
    const px = lerp(150, PREVIEW_W - 150, pingPong(loop(t, 3.2)));
    // 굴러오는 것은 오른쪽에서 들어와 지나간다.
    const rollX = PREVIEW_W + 30 - u * (PREVIEW_W + 90);
    // 그 녀석이 가까워지면 뛴다.
    const gap = Math.abs(rollX - px);
    const air = gap < 80 ? Math.sin(clamp(1 - gap / 80, 0, 1) * Math.PI) * 52 : 0;

    // 떨어지는 것
    const dropY = ((t * 90) % (PREVIEW_H + 40)) - 20;
    g.fillStyle = C.blue;
    circle(g, 92, dropY, 15);
    g.fill();

    // 굴러오는 것
    g.fillStyle = C.yellow;
    circle(g, rollX, gy - 18, 18);
    g.fill();
    g.strokeStyle = C.ink;
    g.lineWidth = 2.5;
    circle(g, rollX, gy - 18, 18);
    g.stroke();

    drawCharacter(g, {
      id: CAST[0],
      x: px,
      y: gy,
      h: 74,
      hop: air,
      armL: air > 2 ? -0.8 : 0,
      armR: air > 2 ? -0.8 : 0,
    });
  }
}

// ---------------------------------------------------------------------------

/** 흔들리는 것의 실제 x. 그리기와 판정이 같은 식을 써야 억울한 판정이 없다. */
function dropX(d: Drop): number {
  const dx = d.sway === 0 ? 0 : Math.sin(d.y / 90 + d.seed) * d.sway;
  return clamp(d.x + dx, d.r, W - d.r);
}

function drawDrop(g: CanvasRenderingContext2D, d: Drop): void {
  const cx = dropX(d);
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

/**
 * 굴러오는 것.
 *
 * 떨어지는 것과 색·모양이 확실히 달라야 한다. 대응이 정반대(비키기 / 뛰어넘기)라
 * 잘못 읽으면 그대로 한 대다. 그래서 분홍 바퀴에 살을 그려 회전을 보여준다.
 */
function drawRoller(g: CanvasRenderingContext2D, r: Roller, t: number): void {
  const cy = GROUND_Y - r.r;

  if (r.warn > 0) {
    // 화면 밖에서 오는 것은 예고가 없으면 반응이 불가능하다.
    const fromLeft = r.vx > 0;
    const x = fromLeft ? 34 : W - 34;
    const pulse = 0.45 + Math.sin(t * 16) * 0.45;
    g.save();
    g.globalAlpha = pulse;
    g.fillStyle = C.pink;
    g.beginPath();
    const dir = fromLeft ? 1 : -1;
    g.moveTo(x + dir * 16, cy);
    g.lineTo(x - dir * 10, cy - 15);
    g.lineTo(x - dir * 10, cy + 15);
    g.closePath();
    g.fill();
    g.restore();
    return;
  }

  g.fillStyle = C.pink;
  circle(g, r.x, cy, r.r);
  g.fill();
  g.strokeStyle = C.ink;
  g.lineWidth = 3;
  circle(g, r.x, cy, r.r);
  g.stroke();

  // 구르는 방향으로 도는 살. 굴러온다는 게 정지 화면에서도 읽힌다.
  const spin = (r.x / r.r) * (r.vx > 0 ? 1 : -1);
  g.save();
  g.translate(r.x, cy);
  g.rotate(spin);
  g.strokeStyle = 'rgba(43, 42, 51, 0.55)';
  g.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    g.beginPath();
    g.moveTo(Math.cos(a) * r.r * 0.75, Math.sin(a) * r.r * 0.75);
    g.lineTo(-Math.cos(a) * r.r * 0.75, -Math.sin(a) * r.r * 0.75);
    g.stroke();
  }
  g.restore();
}
