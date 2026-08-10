import { C, roundRect, text } from './draw';

/**
 * SNAP GAMES 로고 조판.
 *
 * 세 화면(부팅·소개·타이틀)이 같은 글자를 각자 그리고 있었다. 크기만 다르고
 * 모양이 같은 것을 세 군데에 두면 하나만 고쳐서 어긋나기 마련이라 한 곳으로 모은다.
 *
 * "SNAP" 은 잉크색, "GAMES" 는 분홍. 두 낱말의 색이 다르면 로고가 글자가 아니라
 * 하나의 덩어리로 읽힌다. 뒤에 깔린 옅은 판은 배경이 밝을 때 글자가 뜨지 않게 받쳐준다.
 */
export function drawLogo(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const gap = size * 0.26;
  // 두 낱말의 폭을 재서 가운데를 맞춘다. 글꼴이 달라져도 정렬이 유지된다.
  g.save();
  g.font = `900 ${size}px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif`;
  const wSnap = g.measureText('SNAP').width;
  const wGames = g.measureText('GAMES').width;
  g.restore();

  const total = wSnap + gap + wGames;
  const left = cx - total / 2;

  // 받침판 — 아주 옅게 깔아 로고가 배경에 묻히지 않게.
  g.save();
  g.globalAlpha = 0.07;
  g.fillStyle = C.ink;
  roundRect(g, left - size * 0.28, cy - size * 0.62, total + size * 0.56, size * 1.24, size * 0.3);
  g.fill();
  g.restore();

  // 그림자를 한 겹 깔면 납작한 글자에 무게가 생긴다.
  text(g, 'SNAP', left + wSnap / 2, cy + size * 0.06, {
    size, weight: 900, color: 'rgba(43, 42, 51, 0.16)',
  });
  text(g, 'GAMES', left + wSnap + gap + wGames / 2, cy + size * 0.06, {
    size, weight: 900, color: 'rgba(43, 42, 51, 0.16)',
  });

  text(g, 'SNAP', left + wSnap / 2, cy, { size, weight: 900, color: C.ink });
  text(g, 'GAMES', left + wSnap + gap + wGames / 2, cy, { size, weight: 900, color: C.pink });
}
