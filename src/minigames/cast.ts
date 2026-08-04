/**
 * 그림 캐릭터 6인 — 스프라이트로 그리고, 입만 코드로 얹는다.
 *
 * 왜 입만 따로 그리는가:
 * 통짜 그림은 표정이 고정이라 "박자에 맞춰 반응한다"는 감각이 죽는다. 그렇다고
 * 원본에서 입을 지우는 건 실패했다 — 이 그림체는 입이 코와 인중 선으로 이어져 있어
 * 자동으로 도려내면 코까지 날아간다. 대신 **덮어 그린다**. 원본 입이 작은 O 자라,
 * 그보다 큰 입을 불투명하게 얹으면 원본이 완전히 가려진다. 지울 필요가 없다.
 *
 * 그래서 살아남는 것: 스쿼시·점프·기울기·입 벌림·메롱.
 * 죽는 것: 눈 깜빡임과 시선 — 눈은 그림에 박혀 있어 손댈 수 없다.
 */
import { C, clamp } from '../core/draw';
import { sprite } from '../core/sprites';

export type CastId = 'man1' | 'man2' | 'man3' | 'girl1' | 'girl2' | 'girl3';

export const CAST: readonly CastId[] = ['man1', 'man2', 'man3', 'girl1', 'girl2', 'girl3'];

interface SpriteMeta {
  /** 원본 픽셀 크기. 그릴 때 h 로 정규화한다. */
  w: number;
  h: number;
  /** 입 중심(원본 픽셀 좌표). 여기에 벌린 입과 혀를 얹는다. */
  mouth: { x: number; y: number };
}

/**
 * build_assets.py 가 뽑아준 값. 원본 6장을 배경 제거 후 키 220px 로 통일한 결과다.
 * girl1 만 다리가 잘려 있어 키가 아니라 머리 폭으로 맞췄고, 그래서 h 가 196 이다.
 */
const META: Record<CastId, SpriteMeta> = {
  man1: { w: 168, h: 220, mouth: { x: 88.9, y: 95.8 } },
  man2: { w: 121, h: 220, mouth: { x: 69.0, y: 109.5 } },
  man3: { w: 166, h: 220, mouth: { x: 83.1, y: 122.2 } },
  girl1: { w: 199, h: 196, mouth: { x: 100.7, y: 107.8 } },
  girl2: { w: 184, h: 220, mouth: { x: 91.6, y: 119.5 } },
  girl3: { w: 175, h: 220, mouth: { x: 85.3, y: 112.2 } },
};

/** 기본으로 그릴 키(논리 px). drawBody 의 h 기본값 104 와 눈높이를 맞춘 값. */
export const CAST_H = 150;

const MOUTH_IN = '#7A2A36';
const MOUTH_LIP = '#D66874';
const TONGUE = '#F796A6';
const TONGUE_LINE = '#E26E82';

export interface CastOpts {
  id: CastId;
  /** 가로 중심. */
  x: number;
  /** 발밑 기준점. 스쿼시해도 바닥이 뜨지 않도록 아래를 고정한다. */
  y: number;
  /** 그릴 키(논리 px). 생략하면 CAST_H. */
  h?: number;
  /** 0 = 평상시, 1 = 최대로 눌림. 부피를 보존하듯 가로로 퍼진다. */
  squash?: number;
  /** 위로 뜨는 정도(px). */
  hop?: number;
  /** 몸을 기울이는 각도(라디안). */
  tilt?: number;
  /** 좌우 반전. 둘이 마주 보게 세울 때. */
  flip?: boolean;
  /** 0 = 원본 입, 1 = 크게 벌림. 원본 입을 덮으므로 지울 필요가 없다. */
  sing?: number;
  /** 0 = 없음, 1 = 혀를 길게. sing 과 같이 쓰면 벌린 입에서 혀가 나온다. */
  tongue?: number;
  alpha?: number;
}

export function drawCharacter(g: CanvasRenderingContext2D, o: CastOpts): void {
  const img = sprite(o.id);
  if (!img) return; // 프리로드 실패. 게임은 계속 돈다.

  const meta = META[o.id];
  const s = clamp(o.squash ?? 0, 0, 1);
  const baseH = o.h ?? CAST_H;
  // drawBody 와 같은 비율로 눌린다 — 도형 캐릭터와 섞여 나와도 리듬이 같아 보이도록.
  const h = baseH * (1 - s * 0.26);
  const w = (baseH * (meta.w / meta.h)) * (1 + s * 0.22);

  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.translate(o.x, o.y - (o.hop ?? 0));

  // 그림자는 발밑에 남는다 — 점프해도 따라 올라가지 않아야 무게가 느껴진다.
  g.save();
  g.globalAlpha = (o.alpha ?? 1) * 0.13;
  g.fillStyle = C.ink;
  g.beginPath();
  g.ellipse(0, (o.hop ?? 0) + 4, w * 0.34, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  if (o.tilt) g.rotate(o.tilt);
  if (o.flip) g.scale(-1, 1);

  g.drawImage(img, -w / 2, -h, w, h);

  const sing = clamp(o.sing ?? 0, 0, 1);
  const tongue = clamp(o.tongue ?? 0, 0, 1);
  if (sing > 0 || tongue > 0) {
    // 입 좌표를 원본 픽셀 -> 지금 그린 크기로 옮긴다.
    const mx = -w / 2 + (meta.mouth.x / meta.w) * w;
    const my = -h + (meta.mouth.y / meta.h) * h;
    // 스케일 기준을 키로 잡는다. 스쿼시로 가로가 퍼져도 입은 같이 안 늘어나야 한다.
    const k = baseH / meta.h;
    drawMouth(g, mx, my, k, sing, tongue);
  }

  g.restore();
}

/** 원본의 작은 O 자 입을 덮는 큰 입 + 혀. */
function drawMouth(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  k: number,
  sing: number,
  tongue: number,
): void {
  g.lineJoin = 'round';

  if (sing > 0) {
    const rx = (12 + sing * 7) * k;
    const ry = (12 + sing * 17) * k;
    g.fillStyle = MOUTH_IN;
    g.strokeStyle = C.ink;
    g.lineWidth = 4 * k;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    // 아랫입술 — 입 안이 그냥 검은 구멍으로 보이지 않게 한 겹 깐다.
    g.fillStyle = MOUTH_LIP;
    g.beginPath();
    g.ellipse(x, y + ry * 0.55, rx * 0.5, ry * 0.3, 0, 0, Math.PI * 2);
    g.fill();
  }

  if (tongue > 0) {
    const len = (10 + tongue * 26) * k;
    const wd = (13 + tongue * 5) * k;
    g.fillStyle = TONGUE;
    g.strokeStyle = C.ink;
    g.lineWidth = 3 * k;
    g.beginPath();
    roundedTongue(g, x, y, wd, len);
    g.fill();
    g.stroke();

    g.strokeStyle = TONGUE_LINE;
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(x, y + 6 * k);
    g.lineTo(x, y + len - 6 * k);
    g.stroke();
  }
}

function roundedTongue(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  len: number,
): void {
  const r = w / 2;
  g.moveTo(x - r, y);
  g.lineTo(x - r, y + len - r);
  g.arcTo(x - r, y + len, x, y + len, r);
  g.arcTo(x + r, y + len, x + r, y + len - r, r);
  g.lineTo(x + r, y);
  g.closePath();
}
