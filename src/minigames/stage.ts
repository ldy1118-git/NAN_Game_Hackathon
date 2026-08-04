import { C, H, W, beatPulse, circle } from '../core/draw';

export const GROUND_Y = 396;
/** 박자 점의 기본 높이. */
export const BEAT_DOTS_Y = 490;

/**
 * 바닥과 배경 플래시 — 미니게임들이 공유하는 무대.
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
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);

  // 마디 첫 박에 화면 전체가 한 번 밝아진다. 소리와 그림을 묶는 가장 싼 장치.
  const barPulse = beatPulse(beat / 4, 6);
  g.save();
  g.globalAlpha = barPulse * 0.45;
  g.fillStyle = C.white;
  g.fillRect(0, 0, W, H);
  g.restore();

  g.fillStyle = C.bgDeep;
  g.fillRect(0, groundY, W, H - groundY);
  g.strokeStyle = 'rgba(43, 42, 51, 0.12)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, groundY);
  g.lineTo(W, groundY);
  g.stroke();

  drawBeatDots(g, beat, beatDotsY);
}

/** 마디 안 4박을 점으로 표시. 지금이 몇 박인지 눈으로 잡아준다. */
export function drawBeatDots(g: CanvasRenderingContext2D, beat: number, y = BEAT_DOTS_Y): void {
  const inBar = ((Math.floor(beat) % 4) + 4) % 4;
  const pulse = beatPulse(beat, 5);
  for (let i = 0; i < 4; i++) {
    const x = W / 2 + (i - 1.5) * 46;
    const active = beat >= 0 && i === inBar;
    g.fillStyle = active ? C.ink : 'rgba(43, 42, 51, 0.16)';
    circle(g, x, y, active ? 8 + pulse * 7 : 6.5);
    g.fill();
  }
}
