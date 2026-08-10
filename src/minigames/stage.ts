import { C, H, W, beatPulse, circle } from '../core/draw';

export const GROUND_Y = 396;
/** 박자 점의 기본 높이. */
export const BEAT_DOTS_Y = 490;

/**
 * 모든 게임이 공유하는 배경.
 *
 * 예전에는 단색 한 판이었다. 색은 예뻤지만 화면에 깊이가 없어서 캐릭터가 종이에
 * 붙은 스티커처럼 보였다. 세 겹을 얹어 공간을 만든다 —
 *
 *   1. 위아래 그러데이션 (하늘과 바닥의 구분)
 *   2. 천천히 흐르는 색 덩어리 (거리감)
 *   3. 마디 첫 박의 섬광 (박자)
 *
 * 셋 다 `phase` 하나의 함수다. 리듬 게임은 박을, 자유형은 초를 넣는다. 상태가
 * 없으므로 프레임이 튀어도 배경이 어긋나지 않고, 같은 순간은 늘 같은 그림이다.
 *
 * 값이 싸야 한다 — 매 프레임 모든 게임이 부른다. 원 넷과 사각형 몇 개가 전부다.
 */
export function drawBackdrop(g: CanvasRenderingContext2D, phase: number): void {
  g.fillStyle = gradient(g, 'sky', 0, H, ['#FFF9EE', C.bg, '#F5E9D4']);
  g.fillRect(0, 0, W, H);

  // 흐르는 색 덩어리. 서로 다른 속도로 움직여야 거리가 생긴다.
  g.save();
  g.globalAlpha = 0.07;
  for (const b of BLOBS) {
    const x = b.x + Math.sin(phase * b.speed + b.seed) * b.sway;
    const y = b.y + Math.cos(phase * b.speed * 0.7 + b.seed) * b.sway * 0.5;
    g.fillStyle = b.color;
    circle(g, x, y, b.r);
    g.fill();
  }
  g.restore();

  // 마디 첫 박에 화면 전체가 한 번 밝아진다. 소리와 그림을 묶는 가장 싼 장치.
  const barPulse = beatPulse(phase / 4, 6);
  g.save();
  g.globalAlpha = barPulse * 0.4;
  g.fillStyle = C.white;
  g.fillRect(0, 0, W, H);
  g.restore();
}

/**
 * 그러데이션 캐시.
 *
 * 배경은 모든 게임이 매 프레임 부르는데, `createLinearGradient` 는 그때마다 새
 * 객체를 만든다. 초당 120개씩 버려지는 셈이라 만들어 두고 다시 쓴다.
 *
 * 컨텍스트를 키로 쓰는 이유는 그러데이션이 그것을 만든 컨텍스트에 묶이기
 * 때문이다. 앱은 캔버스를 하나만 쓰지만, 시험용 가짜 컨텍스트가 섞여도 서로
 * 남의 것을 집어가지 않는다. WeakMap 이라 컨텍스트가 사라지면 같이 사라진다.
 */
const gradCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();

function gradient(
  g: CanvasRenderingContext2D,
  key: string,
  y0: number,
  y1: number,
  stops: readonly string[],
): CanvasGradient {
  let byKey = gradCache.get(g);
  if (!byKey) {
    byKey = new Map();
    gradCache.set(g, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;

  const grad = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((color, i) => grad.addColorStop(i / (stops.length - 1), color));
  byKey.set(key, grad);
  return grad;
}

const BLOBS = [
  { x: 150, y: 120, r: 130, sway: 22, speed: 0.18, seed: 0, color: C.blue },
  { x: 820, y: 90, r: 100, sway: 18, speed: 0.23, seed: 2.1, color: C.pink },
  { x: 700, y: 430, r: 150, sway: 26, speed: 0.14, seed: 4.2, color: C.mint },
  { x: 120, y: 470, r: 110, sway: 20, speed: 0.2, seed: 1.3, color: C.yellow },
];

/**
 * 바닥이 있는 무대 — 리듬 게임들이 공유한다.
 *
 * `beatDotsY` 로 박자 점의 높이를 옮길 수 있다. 화면 아래쪽에 자기 UI를 두는
 * 게임은 기본 위치(490)와 겹치므로 여기서 비켜주면 된다.
 */
export function drawStage(
  g: CanvasRenderingContext2D,
  beat: number,
  groundY = GROUND_Y,
  beatDotsY = BEAT_DOTS_Y,
): void {
  drawBackdrop(g, beat);
  drawGround(g, beat, groundY);
  drawBeatDots(g, beat, beatDotsY);
}

/**
 * 바닥.
 *
 * 단순한 사각형이었는데, 지평선에 옅은 빛을 깔고 원근이 있는 줄무늬를 얹으면
 * 같은 넓이가 "바닥"으로 읽힌다. 줄 간격이 아래로 갈수록 벌어지는 게 요점이다.
 */
export function drawGround(
  g: CanvasRenderingContext2D,
  phase: number,
  groundY = GROUND_Y,
): void {
  const depth = H - groundY;

  g.fillStyle = gradient(g, `ground${groundY}`, groundY, H, ['#EFE1C7', C.bgDeep]);
  g.fillRect(0, groundY, W, depth);

  // 원근 줄무늬 — 위쪽은 촘촘하고 아래로 갈수록 벌어진다.
  g.save();
  g.globalAlpha = 0.05;
  g.fillStyle = C.ink;
  for (let i = 1; i < 7; i++) {
    const u = i / 7;
    const y = groundY + depth * u * u;
    g.fillRect(0, y, W, 1 + u * 2);
  }
  g.restore();

  // 지평선 — 밝은 선 하나가 바닥과 배경을 갈라준다.
  g.save();
  g.globalAlpha = 0.5 + beatPulse(phase, 5) * 0.3;
  g.fillStyle = C.white;
  g.fillRect(0, groundY - 2, W, 2);
  g.restore();
  g.strokeStyle = 'rgba(43, 42, 51, 0.14)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, groundY);
  g.lineTo(W, groundY);
  g.stroke();
}

/** 마디 안 4박을 점으로 표시. 지금이 몇 박인지 눈으로 잡아준다. */
export function drawBeatDots(g: CanvasRenderingContext2D, beat: number, y = BEAT_DOTS_Y): void {
  const inBar = ((Math.floor(beat) % 4) + 4) % 4;
  const pulse = beatPulse(beat, 5);
  for (let i = 0; i < 4; i++) {
    const x = W / 2 + (i - 1.5) * 46;
    const active = beat >= 0 && i === inBar;
    if (active) {
      // 켜진 점 뒤로 옅은 고리가 퍼진다 — 박이 "쳐졌다"는 느낌.
      g.save();
      g.globalAlpha = pulse * 0.3;
      g.fillStyle = C.pink;
      circle(g, x, y, 14 + (1 - pulse) * 16);
      g.fill();
      g.restore();
    }
    g.fillStyle = active ? C.ink : 'rgba(43, 42, 51, 0.16)';
    circle(g, x, y, active ? 8 + pulse * 7 : 6.5);
    g.fill();
  }
}
