/**
 * 캐릭터 여섯 명 — 그림 파일이 아니라 도형으로 그린다.
 *
 * 처음에는 원본 그림(`images/`)을 스프라이트로 그대로 썼는데, 팔이 그림에 박혀
 * 있어서 손뼉·줄 돌리기·라켓 스윙이 전부 어색했다. 눈도 감을 수 없었다.
 * 그래서 원본을 **참고만 하고** 부위를 나눠 다시 그린다 — 머리 / 몸통 / 팔 둘 /
 * 다리 / 눈 / 입이 각각 독립이라 전부 따로 움직인다.
 *
 * 색은 원본에서 뽑아낸 값 그대로다(`tools/sample_colors.py` 참고). 실루엣과
 * 소품(뿔머리·양갈래·리본·네모 머리)도 원본을 따라가므로 같은 캐릭터로 읽힌다.
 *
 * 좌표계: 발밑이 원점이고 위가 음수. 키 100 단위로 그린 뒤 h/100 으로 스케일한다.
 * 그래서 아래 숫자들은 전부 "키의 몇 %"로 읽으면 된다.
 */
import { clamp, lerp } from '../core/draw';

export type CastId = 'man1' | 'man2' | 'man3' | 'girl1' | 'girl2' | 'girl3';

export const CAST: readonly CastId[] = ['man1', 'man2', 'man3', 'girl1', 'girl2', 'girl3'];

/** 기본으로 그릴 키(논리 px). */
export const CAST_H = 150;

const INK = '#1A1720';
const CHEEK = 'rgba(243, 138, 150, 0.75)';
const MOUTH_IN = '#7A2A36';
const MOUTH_LIP = '#D66874';
const TONGUE = '#F2889F';
const WHITE = '#FFFFFF';

type HeadShape = 'round' | 'egg' | 'box' | 'pear' | 'oval' | 'lean';
type Hair = 'spikes' | 'curl' | 'sprout' | 'pigtails' | 'wavy' | 'none';
type Outfit = 'onesie' | 'overalls' | 'dress';

interface Spec {
  skin: string;
  cloth: string;
  outfit: Outfit;
  head: HeadShape;
  /** 키 100 기준 머리 가로·세로. 이 그림체는 머리가 전체의 절반쯤 된다. */
  headW: number;
  headH: number;
  bodyW: number;
  hair: Hair;
  hairColor?: string;
  bow?: string;
  /** 눈 반지름과 좌우 간격. */
  eyeR: number;
  /** 오른눈만 이 배율로 키운다. 좌우가 똑같으면 손그림 느낌이 사라진다. */
  eyeSkew?: number;
  eyeGap: number;
  /** 속눈썹 — 원본에서 girl2·girl3 만 있다. */
  lash?: boolean;
  freckles?: boolean;
  /** 입 모양. pout 는 girl1 의 오므린 입술. */
  mouth: 'o' | 'pout';
  /** 머리가 통째로 기울어 있는 캐릭터(man1). */
  lean?: number;
  /** 네모 머리의 그늘진 옆면(man3). */
  shade?: string;
  ear?: boolean;
}

/** 색은 원본 이미지에서 뽑은 값. 실루엣도 원본을 따라간다. */
const SPEC: Record<CastId, Spec> = {
  // 노란 우주복, 머리가 오른쪽으로 기울고 귀가 하나 튀어나온 캐릭터
  man1: {
    skin: '#FCE2D0', cloth: '#FDDF51', outfit: 'onesie',
    head: 'lean', headW: 48, headH: 57, bodyW: 32,
    hair: 'spikes', eyeR: 5.4, eyeGap: 11, mouth: 'o', eyeSkew: 1.2,
    lean: 0.2, ear: true,
  },
  // 분홍 우주복, 계란형 머리에 곱슬 한 가닥. 원본부터 메롱하고 있다.
  man2: {
    skin: '#FCE6D4', cloth: '#F193B1', outfit: 'onesie',
    head: 'egg', headW: 47, headH: 56, bodyW: 29,
    hair: 'curl', eyeR: 4.8, eyeGap: 10, mouth: 'o', eyeSkew: 1.12,
  },
  // 파란 우주복, 종이봉투 같은 네모 머리
  man3: {
    skin: '#FCE7D3', cloth: '#4E8BD6', outfit: 'onesie',
    head: 'box', headW: 53, headH: 52, bodyW: 29,
    hair: 'none', eyeR: 5, eyeGap: 12, mouth: 'o', eyeSkew: 0.9,
    freckles: true, shade: '#E8C6AD',
  },
  // 초록 멜빵바지, 큰 동그라미 머리에 새싹과 리본
  girl1: {
    skin: '#FDDFCE', cloth: '#58B056', outfit: 'overalls',
    head: 'round', headW: 57, headH: 54, bodyW: 33,
    hair: 'sprout', bow: '#F7A8C4', eyeR: 4.4, eyeGap: 12,
    mouth: 'pout', freckles: true,
  },
  // 하늘색 원피스, 아래가 넓은 머리에 양갈래와 노란 리본
  girl2: {
    skin: '#FCE2CF', cloth: '#96D1DC', outfit: 'dress',
    head: 'pear', headW: 55, headH: 53, bodyW: 31,
    hair: 'pigtails', bow: '#F5D75E', eyeR: 5, eyeGap: 11,
    lash: true, mouth: 'o',
  },
  // 꽃무늬 원피스, 갈색 긴 웨이브 머리에 흰 리본
  girl3: {
    skin: '#FAE5D0', cloth: '#E0DBB8', outfit: 'dress',
    head: 'oval', headW: 47, headH: 53, bodyW: 30,
    hair: 'wavy', hairColor: '#AA8157', bow: '#FFFFFF',
    eyeR: 4.6, eyeGap: 10, lash: true, mouth: 'o',
  },
};

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
  /** 0 = 뜬 눈, 1 = 감은 눈. */
  blink?: number;
  /** -1(왼쪽) ~ 1(오른쪽) 시선. */
  look?: number;
  /** 0 = 다문 입, 1 = 크게 벌림. */
  sing?: number;
  /** 0 = 없음, 1 = 혀를 길게. */
  tongue?: number;
  /**
   * 팔. **-1 = 위로 들어올림, 0 = 옆으로 늘어뜨림, 1 = 앞으로 모음(손뼉)**.
   * 어깨에서 손까지 직선 하나로 그리므로 값 하나로 자세가 다 나온다.
   */
  armL?: number;
  armR?: number;
  alpha?: number;
}

export function drawCharacter(g: CanvasRenderingContext2D, o: CastOpts): void {
  const s = SPEC[o.id];
  const H = o.h ?? CAST_H;
  const sq = clamp(o.squash ?? 0, 0, 1);

  g.save();
  g.globalAlpha = o.alpha ?? 1;
  g.translate(o.x, o.y - (o.hop ?? 0));

  // 그림자는 발밑에 남는다 — 점프해도 따라 올라가지 않아야 무게가 느껴진다.
  g.save();
  g.globalAlpha = (o.alpha ?? 1) * 0.13;
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(0, (o.hop ?? 0) + 3, H * 0.2, H * 0.045, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  if (o.tilt) g.rotate(o.tilt);
  if (o.flip) g.scale(-1, 1);
  // 키 100 단위로 그린다. 스쿼시는 부피를 보존하듯 가로로 퍼진다.
  g.scale((H / 100) * (1 + sq * 0.2), (H / 100) * (1 - sq * 0.24));
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const shoulderY = -47;
  const bellyY = -30;

  const aL = o.armL ?? 0;
  const aR = o.armR ?? 0;

  drawLegs(g, s);
  // 옆·위로 뻗은 팔은 몸통 뒤에서 어깨가 가려져야 자연스럽고,
  // 앞으로 모은 팔(손뼉)은 몸통 앞으로 나와야 손이 보인다.
  if (aL <= 0) drawArm(g, s, -1, aL, shoulderY, bellyY);
  if (aR <= 0) drawArm(g, s, 1, aR, shoulderY, bellyY);
  drawBody(g, s);
  if (aL > 0) drawArm(g, s, -1, aL, shoulderY, bellyY);
  if (aR > 0) drawArm(g, s, 1, aR, shoulderY, bellyY);
  drawHead(g, s, o);

  g.restore();
}

/** 채우고 같은 경로에 외곽선을 두른다. 이 그림체의 뼈대. */
function ink(g: CanvasRenderingContext2D, fill: string, lw = 2.2): void {
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = lw;
  g.stroke();
}

/**
 * 양 끝이 둥근 막대. 팔·다리를 이걸로 그린다.
 *
 * 반원 두 개를 이어 붙이는데 `arc` 의 스윕 방향을 틀리면 경로가 스스로 교차해서
 * 채우기와 외곽선이 엉킨다(다리가 검은 부츠처럼 보였다). 아래 두 호는 각각
 * 정확히 π 만큼만 돌고 이어진다.
 */
function capsule(
  g: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number, r: number,
): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath();
  g.arc(x0, y0, r, ang + Math.PI / 2, ang + Math.PI * 1.5);
  g.arc(x1, y1, r, ang - Math.PI / 2, ang + Math.PI / 2);
  g.closePath();
}

function drawLegs(g: CanvasRenderingContext2D, s: Spec): void {
  const gap = s.bodyW * 0.28;
  for (const side of [-1, 1]) {
    const x = side * gap;
    capsule(g, x, -16, x, -5.5, 6.4);
    ink(g, s.outfit === 'dress' ? s.skin : s.cloth);
    // 발 — 바깥쪽으로 살짝 벌어진 타원
    g.beginPath();
    g.ellipse(x + side * 2, -3.5, 7.8, 4.4, side * 0.12, 0, Math.PI * 2);
    ink(g, WHITE, 2);
  }
}

/**
 * 팔 — 어깨에서 손까지 직선 하나(캡슐)로 그리고 끝에 손을 붙인다.
 * 관절을 접지 않아도 자세가 읽히는 그림체라, 손 위치만 정하면 팔은 따라온다.
 *
 * @param amount -1 위로 / 0 옆으로 / 1 앞으로 모음
 */
function drawArm(
  g: CanvasRenderingContext2D,
  s: Spec,
  side: -1 | 1,
  amount: number,
  shoulderY: number,
  bellyY: number,
): void {
  const a = clamp(amount, -1, 1);
  const sx = side * (s.bodyW / 2 - 1);
  const restX = side * (s.bodyW / 2 + 13);
  const restY = bellyY + 4;

  let hx: number;
  let hy: number;
  if (a >= 0) {
    // 옆 -> 앞(배 앞 한가운데). 손뼉은 여기서 나온다.
    hx = lerp(restX, side * 4.5, a);
    hy = lerp(restY, bellyY - 1, a);
  } else {
    // 옆 -> 위. 줄 돌리기·만세.
    const u = -a;
    hx = lerp(restX, side * (s.bodyW / 2 + 8), u);
    hy = lerp(restY, shoulderY - 20, u);
  }

  capsule(g, sx, shoulderY + 5, hx, hy, 4.6);
  ink(g, s.outfit === 'dress' || s.outfit === 'overalls' ? s.skin : s.cloth, 2);

  g.beginPath();
  g.arc(hx, hy, 6, 0, Math.PI * 2);
  ink(g, s.skin, 2);
}

function drawBody(g: CanvasRenderingContext2D, s: Spec): void {
  const w = s.bodyW;
  const top = -49;
  const bot = -14;

  if (s.outfit === 'dress') {
    // 아래로 퍼지는 원피스
    g.beginPath();
    g.moveTo(-w / 2 + 1, top);
    g.quadraticCurveTo(-w / 2 - 3, top + 14, -w / 2 - 8, bot);
    g.lineTo(w / 2 + 8, bot);
    g.quadraticCurveTo(w / 2 + 3, top + 14, w / 2 - 1, top);
    g.closePath();
    ink(g, s.cloth);
    // 옷깃
    g.beginPath();
    g.moveTo(-8, top + 1);
    g.quadraticCurveTo(0, top + 8, 8, top + 1);
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    g.stroke();
    if (s.hair === 'wavy') scatterFlowers(g, w, top, bot);
    return;
  }

  // 우주복 / 멜빵바지 — 둥근 몸통
  g.beginPath();
  g.moveTo(-w / 2, top + 4);
  g.quadraticCurveTo(-w / 2 - 2, bot, -w / 2 + 5, bot);
  g.lineTo(w / 2 - 5, bot);
  g.quadraticCurveTo(w / 2 + 2, bot, w / 2, top + 4);
  g.quadraticCurveTo(0, top - 3, -w / 2, top + 4);
  g.closePath();
  ink(g, s.outfit === 'overalls' ? s.cloth : s.cloth);

  if (s.outfit === 'overalls') {
    // 멜빵 주머니 — 앞에 네모 하나
    g.beginPath();
    g.moveTo(-6, bot + 12);
    g.quadraticCurveTo(0, bot + 8, 6, bot + 12);
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    g.stroke();
  } else {
    // 우주복 단추
    g.beginPath();
    g.arc(0, top + 12, 1.6, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
  }
}

/** girl3 원피스의 꽃무늬. */
function scatterFlowers(
  g: CanvasRenderingContext2D, w: number, top: number, bot: number,
): void {
  const pts = [
    [-8, top + 9], [6, top + 7], [-2, top + 16],
    [10, top + 17], [-11, top + 19], [2, bot - 4],
  ];
  g.fillStyle = '#EE9BAE';
  for (const [px, py] of pts) {
    if (Math.abs(px) > w / 2 + 6) continue;
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(px + Math.cos(ang) * 2.1, py + Math.sin(ang) * 2.1, 1.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function headPath(g: CanvasRenderingContext2D, s: Spec, cy: number): void {
  const w = s.headW / 2;
  const h = s.headH / 2;
  g.beginPath();
  switch (s.head) {
    case 'box': {
      // 종이봉투 — 모서리마다 조금씩 다르게 접혀 손그림처럼 보인다.
      g.moveTo(-w + 2, cy - h);
      g.lineTo(w - 3, cy - h - 1.5);
      g.quadraticCurveTo(w + 1, cy - h + 3, w, cy + h - 4);
      g.quadraticCurveTo(w - 2, cy + h, w - 6, cy + h - 1);
      g.lineTo(-w + 5, cy + h);
      g.quadraticCurveTo(-w - 1, cy + h - 2, -w, cy + h - 6);
      g.lineTo(-w - 1, cy - h + 4);
      g.closePath();
      break;
    }
    case 'egg':
      // 위가 좁고 아래가 둥근 계란
      g.moveTo(0, cy - h);
      g.bezierCurveTo(w * 0.75, cy - h * 0.75, w, cy + h * 0.2, 0, cy + h);
      g.bezierCurveTo(-w, cy + h * 0.2, -w * 0.75, cy - h * 0.75, 0, cy - h);
      g.closePath();
      break;
    case 'pear':
      // 아래로 갈수록 넓어지는 둥근 삼각형. 꼭대기가 뾰족하면 고깔처럼 보인다.
      g.moveTo(0, cy - h);
      g.bezierCurveTo(w * 0.74, cy - h * 0.94, w * 0.93, cy + h * 0.22, w * 0.96, cy + h * 0.74);
      g.quadraticCurveTo(0, cy + h + 2, -w * 0.96, cy + h * 0.74);
      g.bezierCurveTo(-w * 0.93, cy + h * 0.22, -w * 0.74, cy - h * 0.94, 0, cy - h);
      g.closePath();
      break;
    default:
      g.ellipse(0, cy, w, h, 0, 0, Math.PI * 2);
  }
}

function drawHead(g: CanvasRenderingContext2D, s: Spec, o: CastOpts): void {
  const cy = -72;

  g.save();
  if (s.lean) {
    g.translate(0, cy);
    g.rotate(s.lean);
    g.translate(0, -cy);
  }

  if (s.hair === 'wavy') drawWavyBack(g, s, cy);

  if (s.ear) {
    g.beginPath();
    g.ellipse(s.headW / 2 - 1, cy + 4, 5, 6.5, 0, 0, Math.PI * 2);
    ink(g, s.skin, 2);
  }

  headPath(g, s, cy);
  ink(g, s.skin);

  if (s.shade) {
    // 네모 머리의 왼쪽 면 — 종이봉투가 접힌 느낌
    g.save();
    headPath(g, s, cy);
    g.clip();
    g.fillStyle = s.shade;
    g.fillRect(-s.headW / 2 - 2, cy - s.headH, 7, s.headH * 2);
    g.restore();
  }

  if (s.hair === 'wavy') drawWavyFront(g, s, cy);
  drawHair(g, s, cy);
  drawFace(g, s, o, cy);

  g.restore();
}

function drawHair(g: CanvasRenderingContext2D, s: Spec, cy: number): void {
  const top = cy - s.headH / 2;
  g.strokeStyle = INK;
  g.lineWidth = 1.7;

  switch (s.hair) {
    case 'spikes':
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * 4.5, top + 2.5);
        g.lineTo(i * 5.4, top - 4);
        g.stroke();
      }
      break;
    case 'curl':
      // 곱슬 한 가닥 — 이 캐릭터의 상징
      g.beginPath();
      g.moveTo(0, top + 1);
      g.bezierCurveTo(1, top - 5, 6, top - 6, 4.5, top - 9.5);
      g.bezierCurveTo(3.4, top - 12.5, -1.5, top - 11, 0.4, top - 8);
      g.stroke();
      break;
    case 'sprout':
      // 새싹 두 장
      g.fillStyle = '#5FBF62';
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(side * 5, top - 5, 5.5, 3, side * 0.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = INK;
        g.lineWidth = 1.4;
        g.stroke();
      }
      if (s.bow) bow(g, 0, top - 1, s.bow, 0.85);
      break;
    case 'pigtails':
      for (const side of [-1, 1]) {
        // 머리 옆에 묶은 다발. 선 몇 개로 흩날리는 결을 낸다.
        g.beginPath();
        g.moveTo(side * s.headW * 0.2, top + 13);
        g.quadraticCurveTo(side * s.headW * 0.46, top + 4, side * s.headW * 0.44, top + 17);
        g.quadraticCurveTo(side * s.headW * 0.36, top + 21, side * s.headW * 0.2, top + 13);
        ink(g, '#F3D9C6', 1.6);
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.moveTo(side * (s.headW * 0.28), top + 7 + i * 3.2);
          g.quadraticCurveTo(
            side * (s.headW * 0.46), top + 3 + i * 3.4,
            side * (s.headW * 0.56), top + 6 + i * 4.4,
          );
          g.strokeStyle = INK;
          g.lineWidth = 1.4;
          g.stroke();
        }
        if (s.bow) bow(g, side * (s.headW * 0.24), top + 9, s.bow, 0.62);
      }
      break;
    case 'wavy':
      if (s.bow) bow(g, 0, top + 1, s.bow, 0.9);
      break;
  }
}

/** girl3 의 긴 웨이브 — 머리 뒤에 먼저 깔린다. */
function drawWavyBack(g: CanvasRenderingContext2D, s: Spec, cy: number): void {
  const w = s.headW / 2;
  const color = s.hairColor ?? '#AA8157';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, cy - s.headH / 2 - 2.5);
    g.bezierCurveTo(
      side * (w + 8), cy - s.headH * 0.44,
      side * (w + 9), cy - s.headH * 0.06,
      side * (w + 6), cy + 9,
    );
    g.quadraticCurveTo(side * (w + 9.5), cy + 21, side * (w + 2), cy + 29);
    g.quadraticCurveTo(side * (w - 6), cy + 16, side * (w - 5), cy - 1);
    g.quadraticCurveTo(side * (w - 6), cy - s.headH * 0.5, 0, cy - s.headH / 2 - 2.5);
    g.closePath();
    ink(g, color, 2);
  }
}

/** girl3 의 앞머리 — 이마 위를 덮고 얼굴 양옆으로 흘러내린다. */
function drawWavyFront(g: CanvasRenderingContext2D, s: Spec, cy: number): void {
  const w = s.headW / 2;
  const h = s.headH / 2;
  const color = s.hairColor ?? '#AA8157';
  g.beginPath();
  g.moveTo(-w * 0.99, cy - h * 0.1);
  g.quadraticCurveTo(-w * 0.95, cy - h * 0.95, 0, cy - h - 1);
  g.quadraticCurveTo(w * 0.95, cy - h * 0.95, w * 0.99, cy - h * 0.1);
  g.quadraticCurveTo(w * 0.82, cy - h * 0.36, w * 0.5, cy - h * 0.5);
  g.quadraticCurveTo(0, cy - h * 0.72, -w * 0.5, cy - h * 0.5);
  g.quadraticCurveTo(-w * 0.82, cy - h * 0.36, -w * 0.99, cy - h * 0.1);
  g.closePath();
  ink(g, color, 2);
}

function bow(
  g: CanvasRenderingContext2D, x: number, y: number, color: string, sc: number,
): void {
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + side * 7 * sc, y - 5 * sc, x + side * 7 * sc, y);
    g.quadraticCurveTo(x + side * 7 * sc, y + 4.5 * sc, x, y);
    g.closePath();
    ink(g, color, 1.5);
  }
  g.beginPath();
  g.arc(x, y, 1.9 * sc, 0, Math.PI * 2);
  ink(g, color, 1.4);
}

function drawFace(
  g: CanvasRenderingContext2D, s: Spec, o: CastOpts, cy: number,
): void {
  const blink = clamp(o.blink ?? 0, 0, 1);
  const look = clamp(o.look ?? 0, -1, 1);
  const eyeY = cy - s.headH * 0.12;

  // 볼터치 — 눈보다 먼저 깔아야 눈이 위로 온다
  g.fillStyle = CHEEK;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(side * s.headW * 0.29, eyeY + 9, s.headW * 0.12, s.headH * 0.075, 0, 0, Math.PI * 2);
    g.fill();
  }

  if (s.freckles) {
    g.fillStyle = 'rgba(196, 138, 110, 0.75)';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(side * (s.headW * 0.22 + i * 3.2), eyeY + 5 + (i % 2) * 2.4, 0.75, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // 눈 — 감을수록 세로로 납작해진다. 이게 스프라이트로는 못 하던 것.
  for (const side of [-1, 1]) {
    const ex = side * s.eyeGap;
    const er = s.eyeR * (side === 1 ? (s.eyeSkew ?? 1) : 1);
    g.save();
    g.translate(ex, eyeY);
    g.scale(1, Math.max(0.06, 1 - blink));
    g.beginPath();
    g.ellipse(0, 0, er, er * 1.08, 0, 0, Math.PI * 2);
    ink(g, WHITE, 1.7);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(look * er * 0.34, 0, er * 0.42, 0, Math.PI * 2);
    g.fill();
    g.restore();

    if (s.lash) {
      g.strokeStyle = INK;
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(ex + side * er * 0.82, eyeY - er * 0.72);
      g.lineTo(ex + side * (er * 1.28), eyeY - er * 1.06);
      g.stroke();
    }
  }

  // 코와 인중 — 이 그림체의 서명 같은 부분. 코에서 입까지 선이 이어진다.
  const mouthY = eyeY + s.headH * 0.3;
  g.strokeStyle = INK;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-2.6, eyeY + s.eyeR + 2.4);
  g.quadraticCurveTo(0, eyeY + s.eyeR + 5.6, 2.6, eyeY + s.eyeR + 2.4);
  g.stroke();
  g.beginPath();
  g.moveTo(0, eyeY + s.eyeR + 4.4);
  g.lineTo(0, mouthY - 2);
  g.stroke();

  drawMouth(g, s, o, mouthY);
}

function drawMouth(
  g: CanvasRenderingContext2D, s: Spec, o: CastOpts, my: number,
): void {
  const sing = clamp(o.sing ?? 0, 0, 1);
  const tongue = clamp(o.tongue ?? 0, 0, 1);

  if (s.mouth === 'pout' && sing < 0.05) {
    // 오므린 입술 — girl1 의 기본 표정
    g.beginPath();
    g.ellipse(0, my, 5.2, 3.4, 0, 0, Math.PI * 2);
    ink(g, '#E88C9A', 1.6);
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(-3, my);
    g.quadraticCurveTo(0, my + 1.4, 3, my);
    g.stroke();
    return;
  }

  // 다물었을 때는 작은 O, 부를수록 세로로 크게 벌어진다.
  const rx = 2.6 + sing * 3.6;
  const ry = 2.4 + sing * 8.5;
  g.beginPath();
  g.ellipse(0, my + sing * 2, rx, ry, 0, 0, Math.PI * 2);
  ink(g, MOUTH_IN, 1.8);

  if (sing > 0.25) {
    g.fillStyle = MOUTH_LIP;
    g.beginPath();
    g.ellipse(0, my + sing * 2 + ry * 0.45, rx * 0.55, ry * 0.28, 0, 0, Math.PI * 2);
    g.fill();
  }

  if (tongue > 0) {
    const len = 5 + tongue * 11;
    g.beginPath();
    capsule(g, 0, my + 1, 0, my + len, 3.2);
    ink(g, TONGUE, 1.6);
  }
}

/**
 * 가끔 깜빡인다. `beat` 의 순수 함수라 프레임이 튀어도 어긋나지 않는다.
 * @param seed 캐릭터마다 다른 값을 주면 다 같이 깜빡이지 않는다.
 */
export function idleBlink(beat: number, seed = 0): number {
  const t = beat * 0.42 + seed * 0.37;
  return t - Math.floor(t) > 0.93 ? 1 : 0;
}
