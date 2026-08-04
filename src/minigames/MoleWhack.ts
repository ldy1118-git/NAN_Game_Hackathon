import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, circle, clamp, easeOut, lerp, text } from '../core/draw';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';

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

const DURATION = 30;
/**
 * 위 줄에 Q W E, 아래 줄에 I O P — 열을 맞춰 둔다.
 * 키보드에서도 두 덩어리가 3개씩이라, 화면 배치가 손 모양과 그대로 겹친다.
 */
const HOLE_GAP = 220;
const FIRST_X = (W - HOLE_GAP * 2) / 2;
const ROW_Y = [248, 412] as const;
const SLOT_ROW = [0, 0, 0, 1, 1, 1] as const;
const SLOT_COL = [0, 1, 2, 0, 1, 2] as const;

/** 등장 간격(초) — 시작과 끝. 사이는 시간에 따라 선형으로 좁아진다. */
const SPAWN_START = 1.15;
const SPAWN_END = 0.42;
/** 머무는 시간(초) — 시작과 끝. */
const STAY_START = 1.5;
/** 캐릭터 키. 덜 올라온 정도를 이 값만큼 아래로 내려 표현한다. */
const MOLE_H = 118;
const STAY_END = 0.72;

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
  readonly duration = DURATION;

  private moles: Mole[] = [];
  private nextSpawn = 0.8;
  private hits = 0;
  private misses = 0;
  private wrong = 0;
  private combo = 0;
  private bestCombo = 0;
  /** 방금 헛친 자리 — 잠깐 붉게 보여준다. */
  private wrongAt: { slot: number; t: number } | null = null;
  private seed = 20260805;

  /** 재현 가능한 난수. Math.random 은 판마다 난이도가 들쭉날쭉해진다. */
  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  start(): void {
    this.moles = [];
    this.nextSpawn = 0.8;
    this.hits = this.misses = this.wrong = this.combo = this.bestCombo = 0;
  }

  // dt 를 안 쓰는 건 이 게임이 순전히 "언제 튀어나왔나"만 보기 때문이다.
  // 위치를 굴리지 않으므로 프레임 간격이 필요 없다.
  update(_dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    const p = clamp(t / DURATION, 0, 1);

    // 등장
    if (t >= this.nextSpawn) {
      const free = [0, 1, 2, 3, 4, 5].filter(
        (s) => !this.moles.some((m) => m.slot === s && !m.hitAt && !m.escaped && t < m.at + m.stay),
      );
      if (free.length > 0) {
        const slot = free[Math.floor(this.rand() * free.length)];
        this.moles.push({
          slot,
          at: t,
          stay: lerp(STAY_START, STAY_END, p),
          hitAt: null,
          escaped: false,
        });
        audio.blip(audio.ctx.currentTime, 330, 0.35, 'sine');
      }
      this.nextSpawn = t + lerp(SPAWN_START, SPAWN_END, p);
    }

    // 입력
    for (let i = 0; i < KEYS.length; i++) {
      if (!input.pressed(KEYS[i])) continue;
      const target = this.moles.find(
        (m) => m.slot === i && !m.hitAt && !m.escaped && t >= m.at && t < m.at + m.stay,
      );
      if (target) {
        target.hitAt = t;
        this.hits++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        audio.clap(audio.ctx.currentTime, 0.9);
        audio.blip(audio.ctx.currentTime, 880 + Math.min(this.combo, 12) * 40, 0.5, 'triangle');
      } else {
        // 아무도 없는 자리를 쳤다. 콤보가 끊긴다.
        this.wrong++;
        this.combo = 0;
        this.wrongAt = { slot: i, t };
        audio.bad(audio.ctx.currentTime);
      }
    }

    // 놓침 확정
    for (const m of this.moles) {
      if (!m.hitAt && !m.escaped && t >= m.at + m.stay) {
        m.escaped = true;
        this.misses++;
        this.combo = 0;
      }
    }

    // 다 지나간 것은 버린다. 애니메이션이 끝날 시간은 남겨둔다.
    this.moles = this.moles.filter((m) => t < m.at + m.stay + 0.8);
    if (this.wrongAt && t - this.wrongAt.t > 0.4) this.wrongAt = null;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

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

      const m = this.moles.find((mm) => mm.slot === i && t >= mm.at);
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
      rank: rankByScore(this.hits, 18, 30),
      headline: `최고 ${this.bestCombo} 연속`,
      rows: [
        { label: '잡음', value: this.hits, color: C.mint },
        { label: '놓침', value: this.misses, color: C.inkSoft },
        { label: '헛침', value: this.wrong, color: C.yellow },
      ],
    };
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
  // up=1 이면 구멍에 서 있고, up=0 이면 키만큼 내려가 잘려서 안 보인다.
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
