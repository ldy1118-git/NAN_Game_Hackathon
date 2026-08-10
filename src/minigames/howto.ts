import { C, roundRect, text } from '../core/draw';

/**
 * 설명 화면이 게임과 나눠 갖는 규격.
 *
 * 게임을 시작하자마자 "뭘 눌러야 하지"를 화면에서 알아내야 하면 첫 판은 늘
 * 버린 판이 된다. 그래서 들어가기 전에 조작과 점수 규칙을 한 번 보여준다.
 *
 * 글만으로는 잘 안 읽히므로 게임마다 **움직이는 작은 그림**을 하나씩 그린다.
 * 그림은 아래 상자 안에서만 그린다고 약속한다 — 씬이 좌표를 옮겨 주므로
 * 게임은 (0,0)~(PREVIEW_W, PREVIEW_H) 를 자기 화면이라고 생각하면 된다.
 */
export const PREVIEW_W = 560;
export const PREVIEW_H = 190;

/** 조작 안내 한 줄. */
export interface Control {
  /** 키 배지에 찍을 글자. 여러 개면 배열. 예: ['←', '→'] */
  keys: readonly string[];
  /** 그 키가 하는 일. 예: '좌우 이동' */
  label: string;
}

/** 키 배지 하나. 실제 키캡처럼 보여야 "이걸 누르라는 거구나"가 바로 읽힌다. */
export function keyCap(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  glow = 0,
): number {
  // 글자 수에 따라 폭이 늘어난다. Space 처럼 긴 것도 한 배지에 들어가도록.
  const w = Math.max(38, 17 + label.length * 12);
  const h = 34;

  g.save();
  g.translate(0, -glow * 2);
  g.fillStyle = 'rgba(43, 42, 51, 0.16)';
  roundRect(g, x, y - h / 2 + 3, w, h, 8);
  g.fill();
  g.fillStyle = glow > 0 ? C.pink : C.white;
  roundRect(g, x, y - h / 2, w, h, 8);
  g.fill();
  g.strokeStyle = C.ink;
  g.lineWidth = 2.5;
  roundRect(g, x, y - h / 2, w, h, 8);
  g.stroke();
  text(g, label, x + w / 2, y, {
    size: 15,
    color: glow > 0 ? C.white : C.ink,
    weight: 800,
  });
  g.restore();

  return w;
}

/** 배지 여러 개를 가로로 이어 그리고 전체 폭을 돌려준다. */
export function keyCaps(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  labels: readonly string[],
  glow = 0,
): number {
  let cursor = x;
  for (const label of labels) {
    cursor += keyCap(g, cursor, y, label, glow) + 6;
  }
  return cursor - x - 6;
}

/** 배지 묶음의 폭을 미리 잰다. 가운데 정렬에 쓴다. */
export function keyCapsWidth(labels: readonly string[]): number {
  let w = 0;
  for (const label of labels) w += Math.max(38, 17 + label.length * 12) + 6;
  return w - 6;
}

/**
 * 미리보기 안에서 쓰는 되풀이 시계.
 *
 * 설명 화면의 그림은 몇 초짜리 동작이 계속 반복되는 형태다. 매번
 * `t % period` 를 쓰는 대신 여기서 0~1 로 정규화해 받는다.
 */
export function loop(t: number, period: number): number {
  return (t % period) / period;
}

/** 0~1 을 갔다 돌아오는 삼각파로. 좌우로 왕복하는 그림에 쓴다. */
export function pingPong(u: number): number {
  return u < 0.5 ? u * 2 : 2 - u * 2;
}
