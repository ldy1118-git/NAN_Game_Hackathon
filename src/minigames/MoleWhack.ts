import type { AudioEngine } from '../core/AudioEngine';
import { C, W, circle, clamp, easeOut, lerp, text } from '../core/draw';
import type { Difficulty } from '../core/difficulty';
import { makeRng, type Rng } from '../core/rng';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';
import { PREVIEW_W, type Control } from './howto';
import { drawBackdrop } from './stage';

/**
 * 두더지 잡기 — 구멍에서 튀어나온 사람을 그 자리 키로 친다.
 *
 * 여섯 구멍이 Q W E · I O P 에 대응한다. 6인 합창과 같은 배치·같은 키라
 * 손가락 위치를 새로 익힐 필요가 없다.
 *
 * 리듬 게임이 아니므로 상태를 dt 로 굴린다. 대신 등장 간격은 점점 좁아지고,
 * 늦게 튀어나온 사람일수록 짧게 머문다 — 뒤로 갈수록 손이 바빠진다.
 */

const KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyI', 'KeyO', 'KeyP'] as const;
const LABELS = ['Q', 'W', 'E', 'I', 'O', 'P'] as const;

/**
 * 위 줄에 Q W E, 아래 줄에 I O P — 열을 맞춰 둔다.
 * 키보드에서도 두 덩어리가 3개씩이라, 화면 배치가 손 모양과 그대로 겹친다.
 */
const HOLE_GAP = 220;
const FIRST_X = (W - HOLE_GAP * 2) / 2;
const ROW_Y = [248, 412] as const;
const SLOT_ROW = [0, 0, 0, 1, 1, 1] as const;
const SLOT_COL = [0, 1, 2, 0, 1, 2] as const;

/** 캐릭터 키. 덜 올라온 정도를 이 값만큼 아래로 내려 표현한다. */
const MOLE_H = 118;

interface Params {
  duration: number;
  /** 등장 간격(초) — 시작과 끝. */
  spawnStart: number;
  spawnEnd: number;
  /** 머무는 시간(초) — 시작과 끝. */
  stayStart: number;
  stayEnd: number;
  /** 두 명이 동시에 나올 확률. 0 이면 항상 한 명씩. */
  doubleChance: number;
  ok: number;
  superb: number;
}

/**
 * 난이도별 조임.
 *
 * 쉬움은 한 명씩만, 넉넉히 머문다. 여섯 키의 자리를 손이 외우는 게
 * 먼저다 — 자리를 모르는 채로 빨라지면 그냥 아무 데나 두드리게 된다.
 */
const PARAMS: Record<Difficulty, Params> = {
  easy: {
    duration: 25,
    spawnStart: 1.5, spawnEnd: 1.05,
    stayStart: 2.1, stayEnd: 1.5,
    doubleChance: 0,
    ok: 11, superb: 18,
  },
  normal: {
    duration: 30,
    spawnStart: 1.15, spawnEnd: 0.65,
    stayStart: 1.6, stayEnd: 1.0,
    doubleChance: 0.12,
    ok: 16, superb: 26,
  },
  hard: {
    duration: 35,
    spawnStart: 0.88, spawnEnd: 0.4,
    stayStart: 1.25, stayEnd: 0.66,
    doubleChance: 0.3,
    ok: 22, superb: 35,
  },
};

interface Mole {
  slot: number;
  /** 튀어나온 시각(초). */
  at: number;
  stay: number;
  /** 맞았으면 그 시각. 안 맞았으면 null. */
  hitAt: number | null;
  /** 그냥 지나쳐 놓친 것으로 확정됐는지. */
  escaped: boolean;
}

function slotX(i: number): number {
  return FIRST_X + SLOT_COL[i] * HOLE_GAP;
}

function slotY(i: number): number {
  return ROW_Y[SLOT_ROW[i]];
}

export class MoleWhack implements FreeGame {
  readonly id = 'molewhack';
  readonly title = '두더지 잡기';
  readonly hint = '튀어나온 사람을 그 자리 키로 — Q W E · I O P';
  readonly order = 60;
  readonly keys = KEYS;
  readonly duration: number;
  readonly controls: readonly Control[] = [
    { keys: ['Q', 'W', 'E'], label: '위 줄 세 구멍' },
    { keys: ['I', 'O', 'P'], label: '아래 줄 세 구멍' },
  ];
  readonly scoring = '들어가기 전에 그 자리 키를 누르면 잡음 · 빈 구멍을 치면 콤보가 끊깁니다';

  private p: Params;
  private rng: Rng;
  private moles: Mole[] = [];
  private nextSpawn: number;
  private hits = 0;
  private misses = 0;
  private wrong = 0;
  private combo = 0;
  private bestCombo = 0;
  /** 방금 헛친 자리 — 잠깐 붉게 보여준다. */
  private wrongAt: { slot: number; t: number } | null = null;

  constructor(difficulty: Difficulty, seed: number) {
    this.p = PARAMS[difficulty];
    this.duration = this.p.duration;
    this.rng = makeRng(seed);
    this.nextSpawn = 0.9;
  }

  start(): void {
    this.moles = [];
    this.nextSpawn = 0.9;
    this.hits = this.misses = this.wrong = this.combo = this.bestCombo = 0;
    this.wrongAt = null;
  }

  // dt 를 안 쓰는 건 이 게임이 순전히 "언제 튀어나왔나"만 보기 때문이다.
  // 위치를 굴리지 않으므로 프레임 간격이 필요 없다.
  update(_dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    const p = clamp(t / this.p.duration, 0, 1);

    if (t >= this.nextSpawn) {
      this.spawn(t, p, audio);
      this.nextSpawn = t + lerp(this.p.spawnStart, this.p.spawnEnd, p);
    }

    this.readInput(t, input, audio);

    // 놓침 확정
    for (const m of this.moles) {
      if (m.hitAt === null && !m.escaped && t >= m.at + m.stay) {
        m.escaped = true;
        this.misses++;
        this.combo = 0;
      }
    }

    // 다 지나간 것은 버린다. 애니메이션이 끝날 시간은 남겨둔다.
    this.moles = this.moles.filter((m) => t < m.at + m.stay + 0.8);
    if (this.wrongAt && t - this.wrongAt.t > 0.4) this.wrongAt = null;
  }

  private spawn(t: number, p: number, audio: AudioEngine): void {
    const stay = lerp(this.p.stayStart, this.p.stayEnd, p);
    // 동시에 둘이 나오면 손이 갈라져야 한다. 어려움의 매운맛은 여기서 나온다.
    const count = this.rng() < this.p.doubleChance ? 2 : 1;

    for (let n = 0; n < count; n++) {
      const free = [0, 1, 2, 3, 4, 5].filter((s) => !this.occupied(s, t));
      if (free.length === 0) return;
      const slot = free[Math.floor(this.rng() * free.length)];
      this.moles.push({ slot, at: t, stay, hitAt: null, escaped: false });
    }
    audio.blip(audio.ctx.currentTime, 330, 0.35, 'sine');
  }

  private occupied(slot: number, t: number): boolean {
    return this.moles.some(
      (m) => m.slot === slot && m.hitAt === null && !m.escaped && t < m.at + m.stay,
    );
  }

  private readInput(t: number, input: FreeInput, audio: AudioEngine): void {
    for (let i = 0; i < KEYS.length; i++) {
      if (!input.pressed(KEYS[i])) continue;
      const target = this.moles.find(
        (m) => m.slot === i && m.hitAt === null && !m.escaped && t >= m.at && t < m.at + m.stay,
      );
      if (target) {
        target.hitAt = t;
        this.hits++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        audio.clap(audio.ctx.currentTime, 0.9);
        audio.blip(audio.ctx.currentTime, 880 + Math.min(this.combo, 12) * 40, 0.5, 'triangle');
        // 맞은 자리에서 위로 튀어오른다 — 어느 구멍을 쳤는지가 눈에 남는다.
        input.burst(slotX(i), slotY(i) - 30, [C.pink, C.yellow, C.white], {
          count: 14, speed: [130, 300], angle: -Math.PI / 2, spread: Math.PI * 1.2, square: true,
        });
        if (this.combo > 0 && this.combo % 5 === 0) input.shake(4);
      } else {
        // 아무도 없는 자리를 쳤다. 콤보가 끊긴다.
        this.wrong++;
        this.combo = 0;
        this.wrongAt = { slot: i, t };
        audio.bad(audio.ctx.currentTime);
        input.shake(5);
      }
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    drawBackdrop(g, t);

    for (let i = 0; i < 6; i++) {
      const x = slotX(i);
      const y = slotY(i);

      // 구멍
      g.save();
      const bad = this.wrongAt?.slot === i ? easeOut(1 - (t - this.wrongAt.t) / 0.4, 2) : 0;
      g.fillStyle = bad > 0 ? C.pink : 'rgba(43, 42, 51, 0.13)';
      g.globalAlpha = bad > 0 ? 0.25 + bad * 0.5 : 1;
      g.beginPath();
      g.ellipse(x, y, 56, 17, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();

      // 가장 최근에 나온 것을 그린다.
      //
      // 맞거나 지나간 두더지도 퇴장 연출을 위해 0.8초 더 배열에 남는데, 그동안
      // 그 구멍은 이미 비어 있는 것으로 쳐서 새 두더지가 나온다. 앞에서부터
      // 찾으면 이미 사라진 옛 두더지가 잡혀 drawMole 이 곧바로 빠져나가므로,
      // 새로 나온 두더지가 보이지 않는 채로 칠 수만 있는 상태가 됐다.
      let m: Mole | null = null;
      for (const mm of this.moles) {
        if (mm.slot !== i || t < mm.at) continue;
        if (!m || mm.at > m.at) m = mm;
      }
      if (m) drawMole(g, m, t, x, y);

      text(g, LABELS[i], x, y + 40, {
        size: 15,
        color: C.inkSoft,
        weight: 800,
        alpha: 0.55,
      });
    }

    // 점수는 가운데 위, 콤보는 오른쪽 — 위 줄 캐릭터(머리 y=142)와 겹치지 않는 자리다.
    text(g, `${this.hits}`, W / 2, 86, { size: 50, color: C.ink });
    text(g, '잡음', W / 2, 118, { size: 14, color: C.inkSoft, weight: 700 });
    if (this.combo >= 3) {
      text(g, `${this.combo} 연속`, W - 30, 92, {
        size: 20,
        color: C.pink,
        weight: 800,
        align: 'right',
      });
    }
  }

  get done(): boolean {
    return false;
  }

  result(): FreeResult {
    const score = this.hits * 10 + this.bestCombo * 5 - this.wrong * 3;
    return {
      score: Math.max(0, score),
      rank: rankByScore(this.hits, this.p.ok, this.p.superb),
      headline: `최고 ${this.bestCombo} 연속`,
      rows: [
        { label: '잡음', value: this.hits, color: C.mint },
        { label: '놓침', value: this.misses, color: C.inkSoft },
        { label: '헛침', value: this.wrong, color: C.yellow },
      ],
    };
  }

  /** 설명 그림 — 여섯 구멍 배치와 키가 그대로 겹친다는 걸 보여준다. */
  preview(g: CanvasRenderingContext2D, t: number): void {
    const gap = 108;
    const firstX = PREVIEW_W / 2 - gap;
    const rowY = [66, 140];
    // 2.4초에 한 명씩, 자리를 옮겨 가며.
    const who = Math.floor(t / 1.1) % 6;
    const age = t % 1.1;
    const up = age < 0.85 ? clamp(age / 0.14, 0, 1) : clamp(1 - (age - 0.85) / 0.14, 0, 1);

    for (let i = 0; i < 6; i++) {
      const x = firstX + SLOT_COL[i] * gap;
      const y = rowY[SLOT_ROW[i]];

      g.fillStyle = 'rgba(43, 42, 51, 0.13)';
      g.beginPath();
      g.ellipse(x, y, 34, 10, 0, 0, Math.PI * 2);
      g.fill();

      if (i === who && up > 0) {
        g.save();
        g.beginPath();
        g.rect(x - 40, 0, 80, y + 8);
        g.clip();
        drawCharacter(g, { id: CAST[i], x, y: y + 8 + (1 - up) * 70, h: 70 });
        g.restore();
      }

      // 눌러야 할 키가 그 구멍 바로 아래 — 배치가 곧 손 모양이라는 게 요점이다.
      const hot = i === who && up > 0.4;
      text(g, LABELS[i], x, y + 26, {
        size: hot ? 17 : 14,
        color: hot ? C.pink : C.inkSoft,
        weight: 900,
        alpha: hot ? 1 : 0.5,
      });
    }
  }
}

/**
 * 구멍에서 올라왔다 내려가는 사람.
 *
 * 맞으면 즉시 아래로 꺼지고 충격 고리가 퍼진다. 안 맞으면 머무는 시간이
 * 끝날 때 스스로 내려간다. 올라오고 내려가는 구간은 짧게 잡아야
 * "지금 칠 수 있다"는 창이 분명해진다.
 */
function drawMole(
  g: CanvasRenderingContext2D,
  m: Mole,
  t: number,
  x: number,
  y: number,
): void {
  const RISE = 0.13;
  const age = t - m.at;
  let up: number;

  if (m.hitAt !== null) {
    const since = t - m.hitAt;
    if (since > 0.35) return;
    up = clamp(1 - since / 0.18, 0, 1);
  } else {
    const down = age - (m.stay - RISE);
    up = down > 0 ? clamp(1 - down / RISE, 0, 1) : clamp(age / RISE, 0, 1);
  }
  if (up <= 0) return;

  g.save();
  // 구멍 아래로는 안 보이게 자른다 — 올라오는 중에는 몸이 반쯤 잠겨 보여야 한다.
  g.beginPath();
  g.rect(x - 70, 0, 140, y + 12);
  g.clip();
  // 발은 구멍 바닥에 두고, 덜 올라온 만큼 통째로 아래로 내린다.
  drawCharacter(g, {
    id: CAST[m.slot],
    x,
    y: y + 12 + (1 - up) * MOLE_H,
    h: MOLE_H,
    squash: m.hitAt !== null ? clamp(1 - (t - m.hitAt) / 0.2, 0, 1) * 0.45 : 0,
    tilt: Math.sin(age * 7) * 0.04,
  });
  g.restore();

  if (m.hitAt !== null) {
    const since = t - m.hitAt;
    if (since < 0.35) {
      g.save();
      g.globalAlpha = (1 - since / 0.35) * 0.8;
      g.strokeStyle = C.pink;
      g.lineWidth = 5;
      circle(g, x, y - 34, 18 + since * 150);
      g.stroke();
      g.restore();
    }
  }
}
