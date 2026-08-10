/**
 * 화면 효과 — 파편과 흔들림.
 *
 * **여기 있는 건 전부 장식이다.** 판정에도, 점수에도, 게임 상태에도 영향을 주지
 * 않는다. 그래서 미니게임의 `draw()` 는 여전히 박의 순수 함수로 남고, 이 레이어만
 * 씬이 dt 로 굴린다. 프레임이 한 번 밀려서 파편이 조금 어긋나는 건 아무 문제가
 * 없지만, 노트가 어긋나는 건 게임이 망가지는 일이라 둘을 섞지 않는다.
 *
 * 난수는 `update`/`burst` 안에서만 쓴다. `draw` 는 이미 정해진 상태를 그리기만
 * 하므로, 같은 순간을 두 번 그려도 같은 그림이 나온다.
 */
import { clamp } from './draw';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 남은 수명(초). */
  life: number;
  maxLife: number;
  r: number;
  color: string;
  /** 초당 낙하 가속. 0 이면 떠다닌다. */
  gravity: number;
  /** 사각 파편이면 회전한다. 0 이면 동그라미. */
  spin: number;
  angle: number;
  square: boolean;
}

export interface BurstOpts {
  count?: number;
  /** 초당 초기 속도 범위. */
  speed?: [number, number];
  /** 파편 반지름 범위. */
  size?: [number, number];
  life?: [number, number];
  gravity?: number;
  /** 퍼지는 방향(라디안). 생략하면 사방. */
  angle?: number;
  /** angle 을 중심으로 벌어지는 폭(라디안). */
  spread?: number;
  square?: boolean;
}

/** 한 화면에 살아 있을 수 있는 파편 수. 넘치면 오래된 것부터 버린다. */
const MAX_PARTS = 260;

export class Fx {
  private parts: Particle[] = [];
  private shakeAmt = 0;
  private shakeT = 0;

  /** 파편 한 다발. (x, y) 에서 터진다. */
  burst(x: number, y: number, colors: readonly string[], o: BurstOpts = {}): void {
    const count = o.count ?? 12;
    const [s0, s1] = o.speed ?? [90, 260];
    const [r0, r1] = o.size ?? [2.5, 6];
    const [l0, l1] = o.life ?? [0.35, 0.8];
    const spread = o.spread ?? Math.PI * 2;
    const base = o.angle ?? 0;

    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * spread;
      const sp = s0 + Math.random() * (s1 - s0);
      const life = l0 + Math.random() * (l1 - l0);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        maxLife: life,
        r: r0 + Math.random() * (r1 - r0),
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: o.gravity ?? 900,
        spin: (Math.random() - 0.5) * 14,
        angle: Math.random() * Math.PI,
        square: o.square ?? false,
      });
    }

    // 넘치면 오래된 것부터 버린다. 파편이 쌓여 프레임을 먹는 게 제일 나쁘다.
    if (this.parts.length > MAX_PARTS) {
      this.parts.splice(0, this.parts.length - MAX_PARTS);
    }
  }

  /** 위에서 쏟아지는 색종이. 결과 화면의 축하용. */
  confetti(w: number, count = 60): void {
    for (let i = 0; i < count; i++) {
      const life = 1.6 + Math.random() * 1.4;
      this.parts.push({
        x: Math.random() * w,
        y: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 90,
        vy: 60 + Math.random() * 120,
        life,
        maxLife: life,
        r: 4 + Math.random() * 5,
        color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
        gravity: 160,
        spin: (Math.random() - 0.5) * 10,
        angle: Math.random() * Math.PI,
        square: true,
      });
    }
  }

  /**
   * 화면을 흔든다. 값이 클수록 크게.
   *
   * 이미 흔들리는 중이면 더 큰 쪽을 쓴다. 더하면 연타할 때 화면이 튀어나간다.
   */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  update(dt: number): void {
    this.shakeT += dt;
    // 0.11초마다 절반으로 잦아든다 — 짧고 날카롭게.
    this.shakeAmt *= Math.pow(0.5, dt / 0.11);
    if (this.shakeAmt < 0.15) this.shakeAmt = 0;

    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      // 공기 저항 — 없으면 파편이 화면 밖으로 총알처럼 나간다.
      p.vx *= Math.pow(0.35, dt);
    }
    if (this.parts.some((p) => p.life <= 0)) {
      this.parts = this.parts.filter((p) => p.life > 0);
    }
  }

  /** 이번 프레임의 흔들림 오프셋. 씬이 translate 로 적용한다. */
  get shakeX(): number {
    return this.shakeAmt === 0 ? 0 : Math.sin(this.shakeT * 71) * this.shakeAmt;
  }

  get shakeY(): number {
    return this.shakeAmt === 0 ? 0 : Math.cos(this.shakeT * 59) * this.shakeAmt * 0.7;
  }

  get busy(): boolean {
    return this.parts.length > 0 || this.shakeAmt > 0;
  }

  draw(g: CanvasRenderingContext2D): void {
    if (this.parts.length === 0) return;
    g.save();
    for (const p of this.parts) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      g.globalAlpha = t < 0.35 ? t / 0.35 : 1;
      g.fillStyle = p.color;
      if (p.square) {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.angle);
        g.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        g.restore();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, p.r * (0.4 + t * 0.6), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }

  clear(): void {
    this.parts.length = 0;
    this.shakeAmt = 0;
  }
}

const CONFETTI = ['#FF5D7E', '#3DA9FC', '#FFC93C', '#4ED6A9', '#B983FF', '#FF9B7A'];
