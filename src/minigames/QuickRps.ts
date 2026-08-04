import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, clamp, easeOut, roundRect, text } from '../core/draw';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';

/**
 * 순발력 가위바위보 — 상대가 낸 것을 보고 **이기는 손**을 낸다.
 *
 * 두더지가 "어디"를 묻는다면 이건 "무엇"을 묻는다. 자리를 찾는 게 아니라
 * 한 단계 생각을 거쳐야 해서, 반사신경만으로는 안 되고 손가락이 꼬인다.
 *
 * 중간에 규칙이 한 번 뒤집힌다 — **지는 손을 내라**로 바뀐다. 익숙해질 때쯤
 * 바닥을 흔들어야 끝까지 긴장이 유지된다.
 */

const DURATION = 30;
/** 가위 바위 보. 인덱스로만 다룬다. */
const HANDS = ['가위', '바위', '보'] as const;
const KEYS = ['ArrowLeft', 'ArrowUp', 'ArrowRight'] as const;
/** 한 판에 주어지는 시간(초) — 시작과 끝. */
const LIMIT_START = 1.9;
const LIMIT_END = 0.85;
/** 이 판부터 규칙이 뒤집힌다. */
const FLIP_AT = 8;

/** i 를 이기는 손. 가위(0)는 바위(1)에게, 바위(1)는 보(2)에게, 보(2)는 가위(0)에게 진다. */
function beats(i: number): number {
  return (i + 1) % 3;
}
function losesTo(i: number): number {
  return (i + 2) % 3;
}

export class QuickRps implements FreeGame {
  readonly id = 'quickrps';
  readonly title = '순발력 가위바위보';
  readonly hint = '상대를 이기는 손을 빠르게 — ← 가위 · ↑ 바위 · → 보';
  readonly order = 110;
  readonly keys = KEYS;
  readonly duration = DURATION;

  /** 상대가 낸 손. */
  private theirs = 0;
  /** 이번 판이 시작한 t. */
  private roundAt = 0;
  private limit = LIMIT_START;
  private round = 0;
  private correct = 0;
  private wrong = 0;
  private timeout = 0;
  private combo = 0;
  private bestCombo = 0;
  /** 방금 판정 — 잠깐 보여준다. */
  private flash: { ok: boolean; t: number; mine: number | null } | null = null;
  private seed = 13579;

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** 이번 판이 "지는 손"을 요구하는가. */
  private get inverted(): boolean {
    return this.round >= FLIP_AT;
  }

  start(): void {
    this.round = 0;
    this.correct = this.wrong = this.timeout = this.combo = this.bestCombo = 0;
    this.flash = null;
    this.theirs = Math.floor(this.rand() * 3);
    this.roundAt = 0;
    this.limit = LIMIT_START;
  }

  private nextRound(t: number): void {
    this.round++;
    // 같은 손이 연달아 나오면 생각 없이 눌러도 맞는다. 반드시 바꾼다.
    let next = Math.floor(this.rand() * 3);
    if (next === this.theirs) next = (next + 1 + Math.floor(this.rand() * 2)) % 3;
    this.theirs = next;
    this.roundAt = t;
    this.limit = lerpLimit(this.round);
  }

  update(_dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    const local = t - this.roundAt;
    const want = this.inverted ? losesTo(this.theirs) : beats(this.theirs);

    for (let i = 0; i < 3; i++) {
      if (!input.pressed(KEYS[i])) continue;
      const ok = i === want;
      this.flash = { ok, t, mine: i };
      if (ok) {
        this.correct++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        audio.blip(audio.ctx.currentTime, 700 + Math.min(this.combo, 10) * 45, 0.6, 'triangle');
      } else {
        this.wrong++;
        this.combo = 0;
        audio.bad(audio.ctx.currentTime);
      }
      this.nextRound(t);
      return;
    }

    // 시간 초과
    if (local > this.limit) {
      this.timeout++;
      this.combo = 0;
      this.flash = { ok: false, t, mine: null };
      audio.bad(audio.ctx.currentTime);
      this.nextRound(t);
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    const local = t - this.roundAt;
    const left = clamp(1 - local / this.limit, 0, 1);

    // 규칙 — 뒤집혔을 때는 크게 알린다.
    if (this.inverted) {
      const pulse = 0.7 + Math.sin(t * 6) * 0.3;
      text(g, '지는 손을 내세요!', W / 2, 62, {
        size: 26,
        color: C.pink,
        weight: 900,
        alpha: pulse,
      });
    } else {
      text(g, '이기는 손을 내세요', W / 2, 62, { size: 20, color: C.inkSoft, weight: 700 });
    }

    // 상대가 낸 손 — 캐릭터 머리(190) 위 빈 자리에 둔다.
    text(g, HANDS[this.theirs], W / 2, 148, { size: 48, color: C.ink });

    drawCharacter(g, {
      id: CAST[4],
      x: W / 2,
      y: 310,
      h: 120,
      armL: -1,
      armR: -1,
    });

    // 남은 시간은 가로 막대로. 캐릭터를 둘러싸는 고리는 버튼까지 파고들었다.
    const bar = 320;
    g.fillStyle = 'rgba(43, 42, 51, 0.1)';
    roundRect(g, W / 2 - bar / 2, 340, bar, 10, 5);
    g.fill();
    g.fillStyle = left > 0.35 ? C.blue : C.pink;
    roundRect(g, W / 2 - bar / 2, 340, bar * left, 10, 5);
    g.fill();

    // 내 선택지
    const bw = 132;
    const gap = 18;
    const total = 3 * bw + 2 * gap;
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - total / 2 + i * (bw + gap);
      const picked = this.flash && this.flash.mine === i && t - this.flash.t < 0.35;
      g.fillStyle = picked ? (this.flash!.ok ? C.mint : C.pink) : 'rgba(43, 42, 51, 0.07)';
      roundRect(g, x, 388, bw, 62, 14);
      g.fill();
      text(g, HANDS[i], x + bw / 2, 412, {
        size: 22,
        color: picked ? C.white : C.ink,
        weight: 800,
      });
      text(g, ['←', '↑', '→'][i], x + bw / 2, 438, {
        size: 14,
        color: picked ? C.white : C.inkSoft,
        weight: 700,
      });
    }

    if (this.flash && t - this.flash.t < 0.4) {
      const pop = easeOut(1 - (this.flash ? t - this.flash.t : 0) / 0.4, 2);
      g.save();
      g.globalAlpha = pop;
      text(g, this.flash.ok ? '맞음!' : this.flash.mine === null ? '늦음' : '틀림', W / 2, 494, {
        size: 24 + pop * 8,
        color: this.flash.ok ? C.mint : C.pink,
        weight: 900,
      });
      g.restore();
    }

    // 점수는 왼쪽 위(게임 이름 아래), 콤보는 오른쪽 —
    // FreePlayScene 이 오른쪽 위 (W-34, 44) 에 남은 시간을 그리므로 그 아래로 피한다.
    text(g, `맞음 ${this.correct}`, 22, 58, {
      size: 16,
      color: C.ink,
      align: 'left',
      weight: 800,
    });
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
    return {
      score: this.correct * 10 + this.bestCombo * 5 - this.wrong * 4,
      // 반응 0.75초로 한 번도 안 틀린 봇이 35개였다. 사람은 규칙이 뒤집힌 뒤
      // 반드시 몇 개 흘리므로, 26개면 거의 완벽하게 해낸 것이다.
      rank: rankByScore(this.correct, 16, 26),
      headline: `최고 ${this.bestCombo} 연속`,
      rows: [
        { label: '맞음', value: this.correct, color: C.mint },
        { label: '틀림', value: this.wrong, color: C.pink },
        { label: '늦음', value: this.timeout, color: C.yellow },
      ],
    };
  }
}

/** 판이 거듭될수록 제한 시간이 줄어든다. 20판이면 최소치에 닿는다. */
function lerpLimit(round: number): number {
  const p = clamp(round / 20, 0, 1);
  return LIMIT_START + (LIMIT_END - LIMIT_START) * p;
}
