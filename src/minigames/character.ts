import { C, circle, clamp, roundRect, shadowed } from '../core/draw';

export interface BodyOpts {
  /** 발밑 기준점. 스쿼시해도 바닥이 뜨지 않도록 아래를 고정한다. */
  x: number;
  y: number;
  w?: number;
  h?: number;
  color: string;
  /** 0 = 평상시, 1 = 최대로 눌림. 부피를 보존하듯 가로로 퍼진다. */
  squash?: number;
  /** 위로 뜨는 정도(px). */
  hop?: number;
  /** 0 = 뜬 눈, 1 = 감은 눈. */
  blink?: number;
  /** -1(왼쪽) ~ 1(오른쪽) 시선 방향. */
  look?: number;
  /** 몸을 기울이는 각도(라디안). */
  tilt?: number;
}

export function drawBody(g: CanvasRenderingContext2D, o: BodyOpts): void {
  const baseW = o.w ?? 92;
  const baseH = o.h ?? 104;
  const s = clamp(o.squash ?? 0, 0, 1);
  const w = baseW * (1 + s * 0.22);
  const h = baseH * (1 - s * 0.26);
  const hop = o.hop ?? 0;
  const look = clamp(o.look ?? 0, -1, 1);
  const blink = clamp(o.blink ?? 0, 0, 1);

  g.save();
  g.translate(o.x, o.y - hop);
  if (o.tilt) g.rotate(o.tilt);

  shadowed(g, () => roundRect(g, -w / 2, -h, w, h, Math.min(26, h / 2.6)), o.color, 7);

  // 얼굴은 몸통 위쪽에 몰아둔다 — 아래쪽은 손이 지나다니는 자리라 비워야 한다.
  // 눈 — 감을수록 세로로 납작해진다.
  const eyeY = -h * 0.7;
  const eyeDX = w * 0.19;
  const eyeR = 8.5;
  g.fillStyle = C.ink;
  for (const sgn of [-1, 1]) {
    const cx = sgn * eyeDX + look * 4;
    g.save();
    g.translate(cx, eyeY);
    g.scale(1, Math.max(0.08, 1 - blink));
    circle(g, 0, 0, eyeR);
    g.fill();
    g.restore();
  }

  // 입 — 눌릴수록 크게 벌어진다.
  g.strokeStyle = C.ink;
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  const mouthY = -h * 0.5;
  const mw = w * 0.16;
  g.moveTo(-mw, mouthY);
  g.quadraticCurveTo(0, mouthY + 6 + s * 10, mw, mouthY);
  g.stroke();

  g.restore();
}

/**
 * 손 — 두 개를 벌렸다 모으는 동작으로 박자를 시각화한다.
 * 몸통 앞(배 높이)에 그리므로, 벌렸을 때 몸 밖으로 확실히 나가도록 폭을 크게 잡고
 * 외곽선을 둘러 몸과 분리해 보이게 한다.
 */
export function drawHands(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  open: number,
  color: string,
  r = 16,
): void {
  const outline = (cx: number, rr: number): void => {
    shadowed(g, () => circle(g, cx, y, rr), color, 5);
    g.strokeStyle = C.ink;
    g.lineWidth = 3.5;
    circle(g, cx, y, rr);
    g.stroke();
  };

  // 거의 붙었으면 두 개를 겹쳐 그리는 대신 하나의 덩어리로 — 손뼉이 한 번으로 읽힌다.
  if (open < 0.16) {
    outline(x, r * 1.32);
    return;
  }
  const dx = 11 + open * 62;
  outline(x - dx, r);
  outline(x + dx, r);
}

/** 정박에 맞춰 퍼져나가는 링. 소리에 시각적 부피를 준다. */
export function shockRing(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  /** 0..1 진행도. 1이면 사라진다. */
  t: number,
  color: string,
  maxR = 96,
): void {
  if (t < 0 || t >= 1) return;
  g.save();
  g.globalAlpha = (1 - t) * 0.8;
  g.strokeStyle = color;
  g.lineWidth = 9 * (1 - t) + 2;
  circle(g, x, y, 12 + maxR * t);
  g.stroke();
  g.restore();
}
