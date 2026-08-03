/** 논리 해상도. 실제 캔버스는 이 비율을 유지한 채 화면에 맞춰 스케일된다. */
export const W = 960;
export const H = 540;

export const C = {
  bg: '#FBF3E4',
  bgDeep: '#F0E4CE',
  ink: '#2B2A33',
  inkSoft: '#6E6A7C',
  pink: '#FF5D7E',
  blue: '#3DA9FC',
  yellow: '#FFC93C',
  mint: '#4ED6A9',
  white: '#FFFFFF',
} as const;

/** 0..1 소수부. 음수 박에서도 안전하게 동작한다. */
export function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * 박에 맞춰 튕기는 엔벨로프. 정박에서 1이 되고 다음 박까지 빠르게 떨어진다.
 * 화면 전체가 "딱" 하고 반응하는 감각은 거의 전부 이 함수 하나에서 나온다.
 *
 * @param power 클수록 더 짧고 날카롭게 튄다.
 */
export function beatPulse(beat: number, power = 5): number {
  const f = fract(beat);
  return Math.pow(1 - f, power);
}

/** 되돌아오지 않는 감속. 0..1 */
export function easeOut(t: number, power = 3): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - c, power);
}

/** 살짝 넘어갔다 돌아오는 탄성. 캐릭터 스쿼시에 쓴다. */
export function easeBack(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  const s = 1.9;
  const u = c - 1;
  return u * u * ((s + 1) * u + s) + 1;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, Math.max(r, 0), 0, Math.PI * 2);
  g.closePath();
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: number | string;
  alpha?: number;
}

export function text(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: TextOpts = {},
): void {
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.fillStyle = o.color ?? C.ink;
  g.font = `${o.weight ?? 700} ${o.size ?? 24}px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;
  g.textAlign = o.align ?? 'center';
  g.textBaseline = o.baseline ?? 'middle';
  g.fillText(s, x, y);
  g.restore();
}

/**
 * 도형 아래에 같은 모양의 그림자를 깔아 플랫한 그림에 무게를 준다.
 * `path` 는 경로만 만들고 fill 하지 않는다 — 여기서 두 번 채우기 때문.
 */
export function shadowed(
  g: CanvasRenderingContext2D,
  path: () => void,
  color: string,
  dy = 6,
): void {
  g.save();
  g.translate(0, dy);
  g.fillStyle = 'rgba(43, 42, 51, 0.13)';
  path();
  g.fill();
  g.restore();

  g.fillStyle = color;
  path();
  g.fill();
}
