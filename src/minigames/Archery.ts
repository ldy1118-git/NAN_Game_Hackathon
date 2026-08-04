import type { AudioEngine } from '../core/AudioEngine';
import { C, W, circle, clamp, easeOut, lerp, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { decay, prevAndNext, windUp } from './beat';
import { drawCharacter, idleBlink } from './cast';
import { type MiniGame, type RenderInfo } from './MiniGame';
import { GROUND_Y, drawStage } from './stage';

/**
 * 양궁 — 조준 링이 과녁 한가운데로 좁혀 들어오는 순간 쏜다.
 *
 * 링의 반지름이 곧 남은 시간이다. 정박에 정확히 금색 과녁 크기까지 줄어들도록
 * 맞춰 뒀으므로, "링이 금색에 겹치는 순간"이 곧 눌러야 하는 순간이다.
 *
 * 핵심은 **누른 순간 링이 있던 자리에 화살이 꽂힌다**는 것. 빨리 쐈으면 링이
 * 아직 컸으니 바깥에, 늦었으면 지나쳤으니 역시 바깥에 꽂힌다. 왜 빗나갔는지를
 * 판정 문구가 아니라 화면이 알려주므로 다음 발을 스스로 고칠 수 있다.
 *
 * 난이도는 링이 좁혀지는 시간(travel)으로 올린다. 3박 → 2박 → 1.5박 → 1박 연속.
 * 시작 반지름은 그대로라 시간이 짧아질수록 링이 빠르게 달려든다.
 *
 * 금색 한가운데에는 더 작은 "명중점"이 있다. 완벽 판정(±52ms)보다 좁은 ±29ms
 * 안에 들어와야 닿는 자리라, 완벽 위에 한 단계를 더 얹은 셈이다. 판정 체계는
 * core 가 관리하므로 건드리지 않고, 명중 수는 이 게임 안에서만 세어 보여준다.
 */

const LEAD_IN = 4;

/** 각 악구의 조준 시간(박). 짧을수록 링이 빨리 좁혀져 어렵다. */
const PHRASES: number[][] = [
  [3, 3, 3, 3],               // 느긋하게 감 잡기
  [2, 2, 2, 2],               // 기본 속도
  [2, 2, 1.5, 1.5],           // 중간에 빨라진다
  [1.5, 1.5, 1.5, 1.5],
  [2, 1, 1, 2, 1, 1],         // 느림-빠름 섞기
  [1, 1, 1, 1, 1, 1],         // 마지막 속사
];

const TARGET_X = 690;
const TARGET_Y = 232;
/** 과녁 링 반지름. 안쪽부터 명중점·금·빨강·파랑·검정·흰색. */
/**
 * 금색 한가운데의 더 작은 원. 여기 꽂히는 걸 "명중"이라 부른다.
 * 완벽 판정(±52ms)보다 더 좁은 ±29ms 안에 들어와야 닿는다 — 완벽 위의 한 단계다.
 * 판정 자체는 core 가 관리하므로 건드리지 않고, 이 게임 안에서만 세고 보여준다.
 */
const BULL_R = 12;
const GOLD_R = 26;
const RED_R = 46;
const BLUE_R = 68;
const DARK_R = 88;
const OUTER_R = 108;

/** 조준 링이 출발하는 반지름. 과녁 바깥에서 시작해 정박에 BULL_R 이 된다. */
const RING_START = 176;

const ARCHER_X = 176;
const ARCHER_H = 150;
const BOW_X = ARCHER_X + 48;
const BOW_Y = GROUND_Y - 86;

/** 화살이 날아가는 데 걸리는 박. 짧게 잡아야 타격감이 산다. */
const FLIGHT = 0.3;

export class Archery implements MiniGame {
  readonly id = 'archery';
  readonly title = '양궁';
  readonly hint = '조준 링이 한가운데 주황 점에 겹치는 순간 쏘세요 — 스페이스';
  readonly order = 20;
  readonly bpm = 118;
  readonly endBeat: number;
  /** 기본 자리(176)는 과녁 한복판이라 문구가 묻힌다. 과녁 위 빈 띠로 올린다. */
  readonly verdictY = 84;

  private events: BeatEvent[];

  constructor() {
    const out: BeatEvent[] = [];
    let t = LEAD_IN;

    for (const phrase of PHRASES) {
      for (const travel of phrase) {
        // cue: 활을 겨누기 시작하는 박. 이때부터 링이 좁혀진다.
        out.push({ beat: t, kind: 'cue', data: { travel } });
        // hit: 링이 금색에 겹치는 박. 정확히 여기서 쏴야 한다.
        out.push({ beat: t + travel, kind: 'hit', data: { travel, from: t } });
        // 다음 조준은 이번 발이 꽂히는 순간 시작된다 — 링은 항상 하나만 보인다.
        t += travel;
      }
      // 최소 2박은 쉬되, 다음 악구가 마디 머리에서 시작하도록 4의 배수로 맞춘다.
      const sum = phrase.reduce((a, b) => a + b, 0);
      t += 2 + ((4 - ((sum + 2) % 4)) % 4);
    }

    this.events = out.sort((a, b) => a.beat - b.beat);
    this.endBeat = t + 1;
  }

  build(): BeatEvent[] {
    return this.events;
  }

  /** 활 쏘기답게 조용하고 팽팽한 그루브. 하이햇을 잘게 깔아 긴장을 준다. */
  groove(step: number, t: number, a: AudioEngine): void {
    const inBar = step % 8;
    if (inBar === 0) a.kick(t, 0.9);
    if (inBar === 4) a.snare(t, 0.55);
    a.hat(t, inBar % 2 === 1 ? 0.42 : 0.2);

    const BASS = [82.41, 0, 0, 0, 65.41, 0, 0, 0];
    const f = BASS[inBar];
    if (f) a.bass(t, f, 0.26, 0.75);
  }

  /** 시위를 당기는 소리. 조준 시간이 짧을수록 높게 울려 속도를 귀로 알린다. */
  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    const travel = (ev.data?.travel as number) ?? 2;
    const fast = travel <= 1;
    a.blip(t, fast ? 330 : 196, 0.5, 'sawtooth');
    if (fast) a.hat(t, 0.9);
  }

  playerSound(t: number, v: Verdict, a: AudioEngine, ev?: BeatEvent): void {
    if (v === 'miss') {
      a.bad(t);
      return;
    }
    // 시위를 놓는 소리 + 과녁에 꽂히는 둔탁한 소리
    a.hat(t, 0.8);
    a.kick(t + FLIGHT * 0.2, 0.5);
    a.blip(t, v === 'perfect' ? 1318.51 : 659.25, 0.7, 'triangle');
    if (v === 'perfect') a.clap(t, 0.9);

    // Runner 가 commit 후에 부르므로 ev.pressedBeat 이 이미 채워져 있다.
    // 명중이면 화살이 꽂히는 시각에 맞춰 위로 뻗는 아르페지오를 얹는다.
    if (ev && isBull(ev, 60 / this.bpm)) {
      const land = t + FLIGHT * 0.2;
      [1567.98, 2093.0].forEach((f, i) => a.blip(land + i * 0.07, f, 0.55, 'sine'));
    }
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    const secPerBeat = 60 / this.bpm;

    drawStage(g, beat);
    drawStand(g);
    drawTarget(g, beat);
    drawStuckArrows(g, r.events, beat, secPerBeat);
    drawAimRing(g, r.events, beat);
    drawArcher(g, r, beat);
    drawFlyingArrows(g, r.events, beat, secPerBeat);
    drawBullBurst(g, r.events, beat, secPerBeat);
    drawBullCount(g, r.events, secPerBeat);

    if (beat < LEAD_IN - 0.5) {
      text(g, '준비...', W / 2, 140, { size: 28, color: C.inkSoft, alpha: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * 이벤트마다 고정된 0..1 난수. 화살이 박히는 방향을 정하는 데 쓴다.
 *
 * `Math.random` 을 쓰면 프레임마다 화살이 떨린다. 박을 넣으면 같은 화살은
 * 언제 그려도 같은 자리다 — draw() 를 박의 순수 함수로 두는 규칙과 같은 이유다.
 */
function hash01(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 화살이 꽂히는 자리.
 *
 * 중심에서의 거리는 **누른 시각의 오차**로 정한다. 좋음 판정의 경계(112ms)가
 * 정확히 빨간 링 바깥선에 닿도록 맞춰 두었으므로, 꽂힌 위치만 봐도 얼마나
 * 어긋났는지 읽힌다. 방향은 이벤트마다 고정된 난수라 매번 다른 데 박힌다.
 */
function landing(ev: BeatEvent, secPerBeat: number): { x: number; y: number; d: number } {
  const errMs = ((ev.pressedBeat ?? ev.beat) - ev.beat) * secPerBeat * 1000;
  const d = clamp((Math.abs(errMs) / 112) * RED_R, 0, OUTER_R + 10);
  const ang = hash01(ev.beat) * Math.PI * 2;
  return { x: TARGET_X + Math.cos(ang) * d, y: TARGET_Y + Math.sin(ang) * d, d };
}

/** 명중점에 꽂혔는지. 완벽 판정보다 더 좁다. */
function isBull(ev: BeatEvent, secPerBeat: number): boolean {
  if (!ev.verdict || ev.verdict === 'miss') return false;
  return landing(ev, secPerBeat).d < BULL_R;
}

/** 지금까지의 명중 수. 이벤트에서 매번 다시 세므로 상태를 들고 있지 않아도 된다. */
function bullCount(events: BeatEvent[], secPerBeat: number): number {
  let n = 0;
  for (const ev of events) if (ev.kind === 'hit' && isBull(ev, secPerBeat)) n++;
  return n;
}

/** 과녁을 받치는 삼각대. 과녁이 공중에 떠 보이지 않게 한다. */
function drawStand(g: CanvasRenderingContext2D): void {
  g.strokeStyle = 'rgba(43, 42, 51, 0.45)';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(TARGET_X - 34, GROUND_Y);
  g.lineTo(TARGET_X, TARGET_Y + OUTER_R - 16);
  g.lineTo(TARGET_X + 34, GROUND_Y);
  g.stroke();
}

function drawTarget(g: CanvasRenderingContext2D, beat: number): void {
  const rings: [number, string][] = [
    [OUTER_R, C.white],
    [DARK_R, C.mint],
    [BLUE_R, C.blue],
    [RED_R, C.pink],
    [GOLD_R, C.yellow],
    [BULL_R, '#FF8A3D'],
  ];

  // 마디 첫 박에 과녁이 아주 살짝 부푼다 — 박자를 과녁에서도 읽을 수 있게.
  const pulse = 1 + Math.max(0, 1 - ((beat % 4) + 4) % 4) * 0.012;

  g.save();
  g.translate(TARGET_X, TARGET_Y);
  g.scale(pulse, pulse);

  // 그림자
  g.save();
  g.globalAlpha = 0.12;
  g.fillStyle = C.ink;
  circle(g, 4, 7, OUTER_R);
  g.fill();
  g.restore();

  for (const [rad, color] of rings) {
    g.fillStyle = color;
    circle(g, 0, 0, rad);
    g.fill();
    g.strokeStyle = C.ink;
    g.lineWidth = rad === OUTER_R ? 3.5 : 2;
    g.stroke();
  }
  g.restore();
}

/**
 * 조준 링 — 반지름이 곧 남은 시간이다.
 *
 * 좁혀지는 속도를 일정하게(선형) 두는 게 중요하다. 이징을 넣으면 마지막
 * 순간의 속도가 달라져서 "언제 눌러야 하는지"를 눈으로 잴 수 없게 된다.
 */
function drawAimRing(g: CanvasRenderingContext2D, events: BeatEvent[], beat: number): void {
  for (const ev of events) {
    if (ev.kind !== 'hit' || ev.verdict) continue;
    const from = ev.data!.from as number;
    const travel = ev.data!.travel as number;
    const p = (beat - from) / travel;
    if (p < 0 || p > 1.25) continue;

    const rad = lerp(RING_START, BULL_R, Math.min(p, 1.25));
    const near = easeOut(clamp(p, 0, 1), 3);
    const fast = travel <= 1;

    g.save();
    g.globalAlpha = p > 1 ? 1 - (p - 1) / 0.25 : 0.5 + near * 0.5;

    // 흰 테두리를 깔고 그 위에 점선을 얹는다.
    // 과녁도 잉크 실선 링이라, 조준 링이 과녁 위로 들어오면 둘이 구분되지 않았다.
    // 점선이라는 것만으로 "이건 움직이는 링"이 되고, 흰 테두리 덕에 금색·파랑·
    // 민트 어느 위에서도 읽힌다. 정확히 이 순간이 눌러야 하는 순간이라 여기가
    // 안 보이면 게임이 성립하지 않는다.
    const lw = 3 + near * 2.5;
    g.lineWidth = lw + 6;
    g.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    circle(g, TARGET_X, TARGET_Y, Math.max(rad, 2));
    g.stroke();

    g.setLineDash(fast ? [14, 9] : [9, 7]);
    g.lineWidth = lw;
    g.strokeStyle = C.ink;
    circle(g, TARGET_X, TARGET_Y, Math.max(rad, 2));
    g.stroke();
    g.setLineDash([]);

    // 링 위의 조준 표식 네 개. 링이 작아질수록 모여들어 "곧 맞는다"가 보인다.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const mx = TARGET_X + Math.cos(a) * rad;
      const my = TARGET_Y + Math.sin(a) * rad;
      const mr = 3.5 + near * 2.5;
      g.fillStyle = C.white;
      circle(g, mx, my, mr + 2.2);
      g.fill();
      g.fillStyle = fast ? C.pink : C.ink;
      circle(g, mx, my, mr);
      g.fill();
    }
    g.restore();
  }
}

/** 이미 박힌 화살들. 판정이 끝나고 비행이 끝난 것만. */
function drawStuckArrows(
  g: CanvasRenderingContext2D, events: BeatEvent[], beat: number, secPerBeat: number,
): void {
  for (const ev of events) {
    if (ev.kind !== 'hit' || !ev.verdict) continue;
    const landedAt = (ev.pressedBeat ?? ev.beat) + FLIGHT;
    if (beat < landedAt) continue;
    const { x, y } = landing(ev, secPerBeat);
    // 꽂힌 직후 잠깐 떨린다
    const shake = decay(beat, landedAt, 0.45, 3) * 0.09 * Math.sin((beat - landedAt) * 60);
    drawArrow(g, x, y, -0.14 + shake);
  }
}

/** 날아가는 중인 화살. 활에서 과녁까지 포물선 하나로 간다. */
function drawFlyingArrows(
  g: CanvasRenderingContext2D, events: BeatEvent[], beat: number, secPerBeat: number,
): void {
  for (const ev of events) {
    if (ev.kind !== 'hit' || !ev.verdict) continue;
    const shotAt = ev.pressedBeat ?? ev.beat;
    const p = (beat - shotAt) / FLIGHT;
    if (p < 0 || p > 1) continue;

    const to = landing(ev, secPerBeat);
    const x = lerp(BOW_X, to.x, p);
    const y = lerp(BOW_Y, to.y, p) - Math.sin(p * Math.PI) * 26;
    // 다음 순간의 위치를 봐서 진행 방향으로 화살을 눕힌다
    const nx = lerp(BOW_X, to.x, Math.min(p + 0.05, 1));
    const ny = lerp(BOW_Y, to.y, Math.min(p + 0.05, 1)) - Math.sin(Math.min(p + 0.05, 1) * Math.PI) * 26;
    drawArrow(g, x, y, Math.atan2(ny - y, nx - x));
  }
}

/** 명중한 순간 금빛이 터진다. 완벽보다 더 좁은 등급이라 보상도 더 커야 한다. */
function drawBullBurst(
  g: CanvasRenderingContext2D, events: BeatEvent[], beat: number, secPerBeat: number,
): void {
  for (const ev of events) {
    if (ev.kind !== 'hit' || !isBull(ev, secPerBeat)) continue;
    const at = (ev.pressedBeat ?? ev.beat) + FLIGHT;
    const age = beat - at;
    if (age < 0 || age > 0.9) continue;
    const t = age / 0.9;

    g.save();
    // 퍼져나가는 금빛 링
    g.globalAlpha = (1 - t) * 0.9;
    g.strokeStyle = '#FFB03A';
    g.lineWidth = 7 * (1 - t) + 2;
    circle(g, TARGET_X, TARGET_Y, BULL_R + 90 * easeOut(t, 2));
    g.stroke();
    // 사방으로 튀는 반짝임
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const d = BULL_R + 70 * easeOut(t, 2);
      g.fillStyle = i % 2 ? C.yellow : '#FF8A3D';
      circle(g, TARGET_X + Math.cos(a) * d, TARGET_Y + Math.sin(a) * d, 5 * (1 - t));
      g.fill();
    }
    g.globalAlpha = 1 - t * t;
    text(g, '명중!', TARGET_X, TARGET_Y - OUTER_R - 24 - easeOut(t, 2) * 18, {
      size: 30 + (1 - Math.min(t * 4, 1)) * 12,
      color: '#FF8A3D',
    });
    g.restore();
  }
}

/** 지금까지 명중 몇 번. 오른쪽 위는 PlayScene 의 콤보 자리라 제목 아래에 붙인다. */
function drawBullCount(
  g: CanvasRenderingContext2D, events: BeatEvent[], secPerBeat: number,
): void {
  const n = bullCount(events, secPerBeat);
  if (n === 0) return;
  text(g, `명중 ${n}`, 22, 54, {
    size: 15, color: '#FF8A3D', align: 'left', weight: 800, alpha: 0.9,
  });
}

function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, ang: number): void {
  const len = 46;
  g.save();
  g.translate(x, y);
  g.rotate(ang);

  g.strokeStyle = C.ink;
  g.lineWidth = 3.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-len, 0);
  g.lineTo(-4, 0);
  g.stroke();

  // 촉
  g.fillStyle = C.ink;
  g.beginPath();
  g.moveTo(7, 0);
  g.lineTo(-7, -5);
  g.lineTo(-7, 5);
  g.closePath();
  g.fill();

  // 깃
  g.fillStyle = C.pink;
  g.beginPath();
  g.moveTo(-len, 0);
  g.lineTo(-len + 13, -6.5);
  g.lineTo(-len + 16, 0);
  g.lineTo(-len + 13, 6.5);
  g.closePath();
  g.fill();
  g.strokeStyle = C.ink;
  g.lineWidth = 1.6;
  g.stroke();

  g.restore();
}

/**
 * 활을 든 캐릭터. 시위를 당기는 정도는 다음 타점이 다가올수록 커진다 —
 * 이 예비동작이 있어야 쏘는 순간이 박자에 맞아 보인다.
 */
function drawArcher(g: CanvasRenderingContext2D, r: RenderInfo, beat: number): void {
  const shot = prevAndNext(r.events, 'hit', beat);
  const since = shot.prev === null ? 99 : beat - shot.prev;
  // 다음 발을 향해 시위를 당기다가, 쏜 직후엔 확 풀린다.
  const pull = Math.max(windUp(beat, shot.next, 0.9), 0) * (since < 0.25 ? 0 : 1);
  const release = decay(beat, shot.prev, 0.4, 3);

  drawCharacter(g, {
    id: 'man1',
    x: ARCHER_X,
    y: GROUND_Y,
    h: ARCHER_H,
    squash: release * 0.22,
    blink: idleBlink(beat, 5),
    // 오른팔은 활을 앞으로 내밀고, 왼팔은 시위를 당긴다.
    armR: 0.75,
    armL: 0.35 + pull * 0.5,
    sing: pull * 0.5,
  });

  drawBow(g, pull, release);
}

function drawBow(g: CanvasRenderingContext2D, pull: number, release: number): void {
  const span = 44;
  // 당길수록 시위가 뒤로 물러난다. 쏜 직후엔 앞으로 튕겨 나간다.
  const string = -pull * 16 + release * 9;

  g.save();
  g.translate(BOW_X, BOW_Y);

  // 활대
  g.strokeStyle = '#8A5A3B';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-6, -span);
  g.quadraticCurveTo(16 + pull * 4, 0, -6, span);
  g.stroke();

  // 시위
  g.strokeStyle = C.ink;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-6, -span);
  g.lineTo(-6 + string, 0);
  g.lineTo(-6, span);
  g.stroke();

  // 메긴 화살 — 쏘기 전까지만 보인다
  if (pull > 0.02 && release < 0.05) {
    g.save();
    g.translate(string, 0);
    drawArrow(g, 26, 0, 0);
    g.restore();
  }
  g.restore();
}
