import { C, circle, clamp, roundRect, shadowed } from '../core/draw';

const NAN_SKIN  = '#F5C2A8';
const NAN_SUIT  = '#3AAAD5';
const NAN_CHEEK = 'rgba(255,112,158,0.58)';
const NAN_RED   = '#CC2244';

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

/**
 * 캐릭터.jpg 를 Canvas 2D 로 재현한 낭만형 인간.
 *
 * drawBody 와 같은 BodyOpts 를 받으므로 squash / hop / look / blink / tilt
 * 애니메이션이 전부 그대로 동작한다.
 * 기본 크기: w=96, h=200 (머리가 크기 때문에 drawBody 보다 h를 넉넉히 줄 것).
 */
export function drawNanChar(g: CanvasRenderingContext2D, o: BodyOpts): void {
  const BW   = o.w ?? 96;
  const BH   = o.h ?? 200;
  const sq   = clamp(o.squash ?? 0, 0, 1);
  const hop  = o.hop  ?? 0;
  const look = clamp(o.look ?? 0, -1, 1);
  const blink = clamp(o.blink ?? 0, 0, 1);

  g.save();
  g.translate(o.x, o.y - hop);
  if (o.tilt) g.rotate(o.tilt);
  g.scale(1 + sq * 0.18, 1 - sq * 0.13);

  // 각 부위 높이 (y=0 이 바닥, 위로 올라갈수록 음수)
  const FH = BH * 0.055;  // 발
  const LH = BH * 0.165;  // 다리
  const BbH = BH * 0.315; // 몸통
  const NH = BH * 0.04;   // 목
  const HH = BH * 0.40;   // 머리 세로축 (타원 반지름의 2배)
  const HW = BW * 0.90;   // 머리 가로 직경

  const lTop = -(FH + LH);
  const bTop = lTop - BbH;
  const nTop = bTop - NH;
  const hMid = nTop - HH * 0.46;   // 타원 중심
  const hTop = nTop - HH;

  // ── 발 ──
  g.strokeStyle = C.ink; g.lineWidth = 2;
  for (const sx of [-0.22, 0.22]) {
    g.fillStyle = NAN_SKIN;
    g.beginPath();
    g.ellipse(BW * sx, -FH * 0.45, BW * 0.155, FH * 0.72, 0, 0, Math.PI * 2);
    g.fill(); g.stroke();
  }

  // ── 다리 ──
  for (const [x1, x2] of [[-0.26, -0.04], [0.04, 0.26]] as [number, number][]) {
    g.fillStyle = NAN_SUIT;
    g.beginPath();
    roundRect(g, BW * x1, lTop, BW * (x2 - x1), LH + 2, 4);
    g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 2;
    g.stroke();
  }

  // ── 몸통 ──
  shadowed(g, () => roundRect(g, -BW * 0.44, bTop, BW * 0.88, BbH, 10), NAN_SUIT, 5);
  g.strokeStyle = C.ink; g.lineWidth = 2.5;
  roundRect(g, -BW * 0.44, bTop, BW * 0.88, BbH, 10);
  g.stroke();

  // V넥 주름
  g.beginPath();
  g.moveTo(-BW * 0.09, bTop);
  g.lineTo(0, bTop + BbH * 0.13);
  g.lineTo(BW * 0.09, bTop);
  g.strokeStyle = C.ink; g.lineWidth = 1.8;
  g.stroke();

  // ── 팔 + 손 ──
  for (const side of [-1, 1] as const) {
    const ax = side > 0 ?  BW * 0.38 : -BW * 0.54;
    const aw = BW * 0.16;
    const ay = bTop + BbH * 0.1;
    const ah = BbH * 0.62;
    g.fillStyle = NAN_SUIT;
    g.beginPath(); roundRect(g, ax, ay, aw, ah, 6);
    g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 2; g.stroke();
    // 손
    g.fillStyle = NAN_SKIN;
    g.beginPath();
    g.ellipse(ax + aw / 2, ay + ah, aw * 0.52, aw * 0.60, 0, 0, Math.PI * 2);
    g.fill(); g.stroke();
  }

  // ── 목 ──
  g.fillStyle = NAN_SKIN;
  g.fillRect(-BW * 0.07, nTop, BW * 0.14, NH + 2);

  // ── 머리 (크고 둥그스름한 타원) ──
  const hRx = HW / 2, hRy = HH * 0.51;
  const hcx = look * 2;
  shadowed(g, () => { g.beginPath(); g.ellipse(hcx, hMid, hRx, hRy, 0, 0, Math.PI * 2); }, NAN_SKIN, 6);
  g.fillStyle = NAN_SKIN;
  g.beginPath(); g.ellipse(hcx, hMid, hRx, hRy, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.ink; g.lineWidth = 2.5; g.stroke();

  // ── 볼터치 ──
  g.fillStyle = NAN_CHEEK;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(hcx + side * hRx * 0.54, hMid + hRy * 0.16, hRx * 0.22, hRy * 0.155, 0, 0, Math.PI * 2);
    g.fill();
  }

  // ── 눈 (짝눈: 왼쪽이 더 높고 약간 작다) ──
  const eyeBaseY = hMid - hRy * 0.24;
  const ER = BW * 0.082;
  for (const { dx, dy, rs } of [
    { dx: -hRx * 0.38, dy: -hRy * 0.09, rs: 0.87 }, // 왼눈
    { dx:  hRx * 0.34, dy: 0,            rs: 1.0  }, // 오른눈
  ]) {
    const ex = hcx + dx + look * 3;
    const ey = eyeBaseY + dy;
    const er = ER * rs;
    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.ellipse(ex, ey, er, er * Math.max(0.07, 1 - blink), 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 1.8; g.stroke();
    if (blink < 0.85) {
      g.fillStyle = C.ink;
      g.beginPath(); g.ellipse(ex + look * 1.5, ey, er * 0.43, er * 0.43 * Math.max(0.08, 1 - blink), 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ── 코 (구불한 선 두 가닥) ──
  const nx = hcx + look * 2.5, ny = hMid + hRy * 0.1;
  g.strokeStyle = C.ink; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(nx - BW * 0.04, ny - BW * 0.022);
  g.quadraticCurveTo(nx - BW * 0.068, ny + BW * 0.01, nx - BW * 0.023, ny + BW * 0.017);
  g.stroke();
  g.beginPath();
  g.moveTo(nx + BW * 0.004, ny - BW * 0.016);
  g.lineTo(nx + BW * 0.008, ny + BW * 0.036);
  g.stroke();

  // ── 입 (O자, 빨간 내부) ──
  const mx = hcx + look * 2, my = hMid + hRy * 0.38;
  g.fillStyle = NAN_RED;
  g.beginPath(); g.ellipse(mx, my, BW * 0.068, BW * 0.052, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.ink; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#EE3355';
  g.beginPath(); g.ellipse(mx, my - BW * 0.006, BW * 0.036, BW * 0.026, 0, 0, Math.PI * 2);
  g.fill();

  // ── 더듬이 (두 가닥, 서로 다른 방향) ──
  g.strokeStyle = C.ink; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); // 왼쪽: 왼편으로 휘어오름
  g.moveTo(hcx - hRx * 0.19, hTop + HH * 0.07);
  g.quadraticCurveTo(hcx - hRx * 0.30, hTop - HH * 0.11, hcx - hRx * 0.16, hTop - HH * 0.22);
  g.stroke();
  g.beginPath(); // 오른쪽: 오른편으로 휘어오름
  g.moveTo(hcx + hRx * 0.08, hTop + HH * 0.05);
  g.quadraticCurveTo(hcx + hRx * 0.25, hTop - HH * 0.09, hcx + hRx * 0.30, hTop - HH * 0.20);
  g.stroke();

  g.restore();
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
