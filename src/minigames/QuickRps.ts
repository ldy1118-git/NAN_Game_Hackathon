import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, clamp, easeOut, roundRect, text } from '../core/draw';
import type { Difficulty } from '../core/difficulty';
import { makeRng, type Rng } from '../core/rng';
import { rankByScore, type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';
import { PREVIEW_H, PREVIEW_W, type Control } from './howto';
import { drawBackdrop } from './stage';

/**
 * 순발력 가위바위보 — 상대가 낸 것을 보고 **이기는 손**을 낸다.
 *
 * 두더지가 "어디"를 묻는다면 이건 "무엇"을 묻는다. 자리를 찾는 게 아니라
 * 한 단계 생각을 거쳐야 해서, 반사신경만으로는 안 되고 손가락이 꼬인다.
 *
 * 중간에 규칙이 뒤집힌다 — **지는 손을 내라**로 바뀐다. 이게 이 게임의 전부라
 * 화면 절반을 써서 알린다. 작게 한 줄로 적어 뒀을 때는 규칙이 바뀐 줄도 모르고
 * 계속 이기는 손을 내다가 끝났다.
 *
 * 손은 글자 대신 손모양으로 그린다. "가위"라는 글자를 읽고 → 뜻을 떠올리고 →
 * 이기는 손을 고르는 세 단계였는데, 모양이면 첫 단계가 통째로 사라진다.
 */

/**
 * 가위 바위 보. 인덱스로만 다룬다.
 *
 * **판 안에서는 손모양만 쓴다.** 글자를 읽고 → 뜻을 떠올리고 → 이길 손을 고르는
 * 세 단계였는데, 모양이면 첫 단계가 통째로 사라진다. 0.9초 안에 눌러야 하는
 * 게임에서 그 한 단계가 승부를 갈랐다.
 */
export const HANDS = ['✌️', '✊', '🖐️'] as const;
const KEYS = ['ArrowLeft', 'ArrowUp', 'ArrowRight'] as const;
const ARROWS = ['←', '↑', '→'] as const;

/** i 를 이기는 손. 가위(0)는 바위(1)에게, 바위(1)는 보(2)에게, 보(2)는 가위(0)에게 진다. */
function beats(i: number): number {
  return (i + 1) % 3;
}
function losesTo(i: number): number {
  return (i + 2) % 3;
}

interface Params {
  duration: number;
  /** 한 판에 주어지는 시간(초) — 시작과 끝. */
  limitStart: number;
  limitEnd: number;
  /** 이 판 수에 걸쳐 제한 시간이 최소치까지 줄어든다. */
  rampRounds: number;
  /** 규칙이 처음 뒤집히는 판 범위. null 이면 끝까지 안 뒤집힌다. */
  firstFlip: [number, number] | null;
  /** 그 뒤로 다시 뒤집히는 간격 범위. null 이면 한 번만 뒤집힌다. */
  flipEvery: [number, number] | null;
  ok: number;
  superb: number;
}

/**
 * 난이도별 조임.
 *
 * 쉬움은 규칙이 아예 안 뒤집힌다. "보고 이기는 손 내기"만 손에 익히는
 * 단계다. 뒤집기까지 한꺼번에 주면 둘 다 못 배운다.
 */
const PARAMS: Record<Difficulty, Params> = {
  easy: {
    duration: 25,
    limitStart: 2.4, limitEnd: 1.7, rampRounds: 16,
    firstFlip: null, flipEvery: null,
    ok: 11, superb: 18,
  },
  normal: {
    duration: 30,
    limitStart: 2.0, limitEnd: 1.2, rampRounds: 20,
    firstFlip: [7, 10], flipEvery: null,
    ok: 14, superb: 23,
  },
  hard: {
    duration: 35,
    limitStart: 1.7, limitEnd: 0.9, rampRounds: 22,
    firstFlip: [3, 5], flipEvery: [4, 6],
    ok: 17, superb: 28,
  },
};

export class QuickRps implements FreeGame {
  readonly id = 'quickrps';
  readonly title = '순발력 가위바위보';
  readonly hint = '상대를 이기는 손을 빠르게 — 규칙이 뒤집힐 수 있습니다';
  readonly order = 110;
  readonly keys = KEYS;
  readonly duration: number;
  /**
   * 여기서만 손모양 옆에 이름을 적는다.
   *
   * 판 안에서는 글자를 안 쓰지만, 설명 화면의 일은 "이 그림이 무엇인지" 알려주는
   * 것이다. ✌️ 가 가위라는 걸 한 번은 말해줘야 판에서 모양만 보고도 읽힌다.
   */
  readonly controls: readonly Control[] = [
    { keys: ['←'], label: `${HANDS[0]} 가위` },
    { keys: ['↑'], label: `${HANDS[1]} 바위` },
    { keys: ['→'], label: `${HANDS[2]} 보` },
  ];
  readonly scoring = '상대를 이기는 손을 내면 점수 · 뒤집히면 지는 손을 내야 합니다';

  private p: Params;
  private rng: Rng;
  /** 규칙이 뒤집히는 판 번호들. 오름차순. */
  private flips: number[];

  /** 상대가 낸 손. */
  private theirs = 0;
  /** 이번 판이 시작한 t. */
  private roundAt = 0;
  private limit: number;
  private round = 0;
  private correct = 0;
  private wrong = 0;
  private timeout = 0;
  private combo = 0;
  private bestCombo = 0;
  /** 방금 판정 — 잠깐 보여준다. */
  private flash: { ok: boolean; t: number; mine: number | null } | null = null;
  /** 규칙이 방금 뒤집힌 시각. 크게 알리는 연출에 쓴다. */
  private flippedAt = -99;

  constructor(difficulty: Difficulty, seed: number) {
    this.p = PARAMS[difficulty];
    this.duration = this.p.duration;
    this.rng = makeRng(seed);
    this.limit = this.p.limitStart;
    this.flips = this.makeFlips();
    this.theirs = Math.floor(this.rng() * 3);
  }

  /**
   * 규칙이 뒤집히는 판 번호를 미리 뽑아 둔다.
   *
   * 매번 같은 판에서 뒤집히면 몇 번 해보고 외워 버린다. 판 번호를 씨앗에서
   * 뽑되 간격의 범위는 난이도가 정하므로, "이 난이도는 이쯤에서 흔들린다"는
   * 감각은 남으면서 정확한 지점은 매번 달라진다.
   */
  private makeFlips(): number[] {
    const { firstFlip, flipEvery } = this.p;
    if (!firstFlip) return [];

    const out: number[] = [];
    let at = firstFlip[0] + Math.floor(this.rng() * (firstFlip[1] - firstFlip[0] + 1));
    out.push(at);

    if (flipEvery) {
      // 한 판이 40판을 넘길 일은 없다. 넉넉히 만들어 두고 넘치는 건 안 쓴다.
      while (at < 60) {
        at += flipEvery[0] + Math.floor(this.rng() * (flipEvery[1] - flipEvery[0] + 1));
        out.push(at);
      }
    }
    return out;
  }

  /** 이번 판이 "지는 손"을 요구하는가 — 뒤집힌 횟수가 홀수면 그렇다. */
  private get inverted(): boolean {
    return this.flips.filter((f) => f <= this.round).length % 2 === 1;
  }

  start(): void {
    this.round = 0;
    this.correct = this.wrong = this.timeout = this.combo = this.bestCombo = 0;
    this.flash = null;
    this.roundAt = 0;
    this.flippedAt = -99;
    this.limit = this.p.limitStart;
  }

  private nextRound(t: number, audio: AudioEngine): void {
    const wasInverted = this.inverted;
    this.round++;

    // 같은 손이 연달아 나오면 생각 없이 눌러도 맞는다. 반드시 바꾼다.
    let next = Math.floor(this.rng() * 3);
    if (next === this.theirs) next = (next + 1 + Math.floor(this.rng() * 2)) % 3;
    this.theirs = next;
    this.roundAt = t;
    this.limit = this.limitFor(this.round);

    if (this.inverted !== wasInverted) {
      this.flippedAt = t;
      // 규칙이 바뀐 걸 못 보고 지나치는 게 가장 억울하다. 소리로도 못을 박는다.
      const now = audio.ctx.currentTime;
      [880, 622.25, 440].forEach((f, i) => audio.blip(now + i * 0.07, f, 0.9, 'square'));
      audio.snare(now, 1.1);
    }
  }

  private limitFor(round: number): number {
    const u = clamp(round / this.p.rampRounds, 0, 1);
    return this.p.limitStart + (this.p.limitEnd - this.p.limitStart) * u;
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
        input.burst(W / 2, 172, [C.mint, C.white, C.yellow], {
          count: 12, speed: [130, 300], size: [3, 6], square: true,
        });
      } else {
        this.wrong++;
        this.combo = 0;
        audio.bad(audio.ctx.currentTime);
        input.shake(8);
      }
      this.nextRound(t, audio);
      return;
    }

    // 시간 초과
    if (local > this.limit) {
      this.timeout++;
      this.combo = 0;
      this.flash = { ok: false, t, mine: null };
      audio.bad(audio.ctx.currentTime);
      this.nextRound(t, audio);
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const inv = this.inverted;
    const flipAge = t - this.flippedAt;

    // 뒤집힌 동안에는 바닥색부터 바뀐다. 화면 어디를 보고 있어도 규칙이 보인다.
    drawBackdrop(g, t);
    if (inv) {
      g.save();
      g.globalAlpha = 0.1 + Math.sin(t * 4) * 0.03;
      g.fillStyle = C.pink;
      g.fillRect(0, 0, W, H);
      g.restore();
    }
    // 막 뒤집힌 순간의 섬광.
    if (flipAge >= 0 && flipAge < 0.5) {
      g.save();
      g.globalAlpha = (1 - flipAge / 0.5) * 0.55;
      g.fillStyle = inv ? C.pink : C.blue;
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    this.drawRuleBanner(g, t);
    this.drawTheirHand(g, t);
    this.drawTimeBar(g, t);
    this.drawChoices(g, t);
    this.drawScore(g);
  }

  /**
   * 규칙 띠.
   *
   * "이기는" 일 때는 조용한 한 줄, "지는" 일 때는 화면을 가로지르는 분홍 띠에
   * 흔들리는 큰 글씨. 크기 차이가 이만큼 나야 규칙이 바뀐 걸 놓치지 않는다.
   */
  private drawRuleBanner(g: CanvasRenderingContext2D, t: number): void {
    if (!this.inverted) {
      text(g, '이기는 손을 내세요', W / 2, 54, { size: 22, color: C.inkSoft, weight: 700 });
      return;
    }

    const flipAge = t - this.flippedAt;
    // 막 바뀐 참이면 크게 흔들리고, 시간이 지나면 은은한 맥박만 남는다.
    const fresh = flipAge < 1.2 ? 1 - flipAge / 1.2 : 0;
    const shake = Math.sin(t * 26) * fresh * 7;
    const pulse = 0.85 + Math.sin(t * 5) * 0.15;

    g.save();
    g.translate(shake, 0);
    g.globalAlpha = pulse;
    g.fillStyle = C.pink;
    roundRect(g, 40, 22, W - 80, 66, 18);
    g.fill();
    g.restore();

    g.save();
    g.translate(shake, 0);
    text(g, '⚠ 지는 손을 내세요! ⚠', W / 2, 55, {
      size: 34 + fresh * 8,
      color: C.white,
      weight: 900,
    });
    g.restore();

    if (fresh > 0) {
      g.save();
      g.globalAlpha = fresh;
      text(g, '규칙이 뒤집혔습니다', W / 2, 104, {
        size: 19,
        color: C.pink,
        weight: 800,
      });
      g.restore();
    }
  }

  /** 상대가 낸 손. 뒤집혔을 때는 테두리까지 분홍으로 바꿔 한 번 더 알린다. */
  private drawTheirHand(g: CanvasRenderingContext2D, t: number): void {
    const inv = this.inverted;
    const y = 172;

    g.save();
    g.fillStyle = inv ? 'rgba(255, 93, 126, 0.14)' : 'rgba(61, 169, 252, 0.12)';
    roundRect(g, W / 2 - 92, y - 56, 184, 112, 22);
    g.fill();
    g.strokeStyle = inv ? C.pink : C.blue;
    g.lineWidth = inv ? 4 : 2.5;
    roundRect(g, W / 2 - 92, y - 56, 184, 112, 22);
    g.stroke();
    g.restore();

    // 상대의 손은 살짝 흔들린다 — 방금 낸 것처럼 보이도록.
    const bob = Math.sin(t * 3) * 3;
    text(g, HANDS[this.theirs], W / 2, y + bob, { size: 72 });
    text(g, '상대', W / 2, y - 74, { size: 14, color: C.inkSoft, weight: 700 });

    drawCharacter(g, {
      id: CAST[4],
      x: W / 2,
      y: 330,
      h: 104,
      armL: -1,
      armR: -1,
      sing: inv ? 0.7 : 0,
    });
  }

  private drawTimeBar(g: CanvasRenderingContext2D, t: number): void {
    const local = t - this.roundAt;
    const left = clamp(1 - local / this.limit, 0, 1);
    const bar = 320;
    g.fillStyle = 'rgba(43, 42, 51, 0.1)';
    roundRect(g, W / 2 - bar / 2, 352, bar, 10, 5);
    g.fill();
    g.fillStyle = left > 0.35 ? (this.inverted ? C.pink : C.blue) : C.pink;
    roundRect(g, W / 2 - bar / 2, 352, bar * left, 10, 5);
    g.fill();
  }

  private drawChoices(g: CanvasRenderingContext2D, t: number): void {
    const bw = 132;
    const gap = 18;
    const total = 3 * bw + 2 * gap;
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - total / 2 + i * (bw + gap);
      const picked = this.flash && this.flash.mine === i && t - this.flash.t < 0.35;
      g.fillStyle = picked ? (this.flash!.ok ? C.mint : C.pink) : 'rgba(43, 42, 51, 0.07)';
      roundRect(g, x, 386, bw, 74, 14);
      g.fill();
      text(g, HANDS[i], x + bw / 2, 412, { size: 34 });
      text(g, ARROWS[i], x + bw / 2, 444, {
        size: 15,
        color: picked ? C.white : C.inkSoft,
        weight: 700,
      });
    }

    if (this.flash && t - this.flash.t < 0.4) {
      const pop = easeOut(1 - (t - this.flash.t) / 0.4, 2);
      g.save();
      g.globalAlpha = pop;
      text(g, this.flash.ok ? '맞음!' : this.flash.mine === null ? '늦음' : '틀림', W / 2, 496, {
        size: 24 + pop * 8,
        color: this.flash.ok ? C.mint : C.pink,
        weight: 900,
      });
      g.restore();
    }
  }

  private drawScore(g: CanvasRenderingContext2D): void {
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
      score: Math.max(0, this.correct * 10 + this.bestCombo * 5 - this.wrong * 4),
      rank: rankByScore(this.correct, this.p.ok, this.p.superb),
      headline: `최고 ${this.bestCombo} 연속`,
      rows: [
        { label: '맞음', value: this.correct, color: C.mint },
        { label: '틀림', value: this.wrong, color: C.pink },
        { label: '늦음', value: this.timeout, color: C.yellow },
      ],
    };
  }

  /** 설명 그림 — 상대 손이 바뀌고, 이기는 손 쪽 버튼이 켜진다. */
  preview(g: CanvasRenderingContext2D, t: number): void {
    const step = Math.floor(t / 1.3) % 3;
    const theirs = step;
    const want = beats(theirs);
    const age = (t % 1.3) / 1.3;

    text(g, '상대', 108, 40, { size: 13, color: C.inkSoft, weight: 700 });
    text(g, HANDS[theirs], 108, 84, { size: 54 });

    // 화살표
    g.strokeStyle = C.inkSoft;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(158, 84);
    g.lineTo(196, 84);
    g.stroke();
    g.beginPath();
    g.moveTo(196, 84);
    g.lineTo(186, 77);
    g.moveTo(196, 84);
    g.lineTo(186, 91);
    g.stroke();

    text(g, '이기는 손', 300, 34, { size: 13, color: C.inkSoft, weight: 700 });

    const bw = 84;
    const gap = 10;
    for (let i = 0; i < 3; i++) {
      const x = 232 + i * (bw + gap);
      // 조금 뜸을 들였다가 정답이 켜진다 — 생각하는 시간이 있다는 걸 보여준다.
      const on = i === want && age > 0.35;
      g.fillStyle = on ? C.mint : 'rgba(43, 42, 51, 0.07)';
      roundRect(g, x, 56, bw, 62, 12);
      g.fill();
      text(g, HANDS[i], x + bw / 2, 78, { size: 26 });
      text(g, ARROWS[i], x + bw / 2, 104, {
        size: 13,
        color: on ? C.white : C.inkSoft,
        weight: 700,
      });
    }

    // 아래쪽에 뒤집힘 경고를 미리 한 번 보여준다.
    const warn = 0.4 + Math.sin(t * 4) * 0.35;
    g.save();
    g.globalAlpha = warn;
    g.fillStyle = C.pink;
    roundRect(g, PREVIEW_W / 2 - 150, PREVIEW_H - 46, 300, 32, 10);
    g.fill();
    g.restore();
    text(g, '중간에 「지는 손」으로 뒤집힙니다', PREVIEW_W / 2, PREVIEW_H - 30, {
      size: 14,
      color: C.white,
      weight: 800,
    });
  }
}
