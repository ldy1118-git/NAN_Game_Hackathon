import type { AudioEngine } from '../core/AudioEngine';
import { C, H, W, easeOut, text } from '../core/draw';
import { type FreeGame, type FreeInput, type FreeResult } from './FreeGame';
import { CAST, drawCharacter } from './cast';

/**
 * 눈치게임 — 다섯 명과 함께 1부터 외친다. 겹치면 지고, 끝까지 못 외쳐도 진다.
 *
 * 나머지 게임들이 "빨리·정확히"를 묻는다면 이건 **얼마나 참느냐**를 묻는다.
 * 손은 내내 놀고 있고, 누르는 순간 하나로 전부가 결정된다.
 *
 * 규칙을 그대로 옮겼다. 외친 사람은 그 숫자를 가지고 빠지므로, 늦게 외칠수록
 * 큰 숫자를 얻지만 남은 사람이 줄어 겹칠 위험은 오히려 커진다. 다 뺏기고 혼자
 * 남으면 꼴찌다. **한 판에 한 번만 외친다** — 그래서 짧고 팽팽하다.
 *
 * 세 판을 하고 얻은 숫자를 합친다.
 *
 * 난수는 시드로 고정한다. 판마다 운이 달라지면 실력이 늘어도 알 수가 없다.
 */

const DURATION = 0; // 세 판을 마치면 끝
const SETS = 3;
const RIVALS = 5;
/** 이 안에서 둘이 외치면 겹친 것으로 본다(초). */
const GAP = 0.26;
/** AI 들이 외치는 시각의 범위(초). */
const FIRST_AT = 0.9;
const LAST_AT = 5.4;
/** 판 사이 쉬는 시간(초). */
const BREAK = 1.5;

interface Rival {
  cast: number;
  /** 외칠 시각(판 시작 후 초). */
  at: number;
  /** 외치면서 가져간 숫자. 아직이면 null. */
  took: number | null;
}

type Outcome = 'clash' | 'last' | 'ok';

interface SetResult {
  outcome: Outcome;
  /** 내가 가져간 숫자. 실패면 0. */
  num: number;
}

export class NunchiGame implements FreeGame {
  readonly id = 'nunchi';
  readonly title = '눈치게임';
  readonly hint = '아무도 없을 때 혼자 외치세요 — 늦을수록 큰 숫자, 스페이스';
  readonly order = 90;
  readonly keys = ['Space'] as const;
  readonly duration = DURATION;

  private rivals: Rival[] = [];
  private setIdx = 0;
  private setAt = 0;
  private breakLeft = 0;
  /** 다음에 외쳐질 숫자. */
  private nextNum = 1;
  private results: SetResult[] = [];
  /** 이번 판이 끝났으면 그 결과. 진행 중이면 null. */
  private ended: SetResult | null = null;
  /** 내가 외친 시각(판 기준). */
  private myCall: number | null = null;
  private overT = 0;
  private seed = 424242;

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  start(): void {
    this.setIdx = 0;
    this.results = [];
    this.overT = 0;
    this.beginSet(0);
  }

  private beginSet(t: number): void {
    // 다섯 명의 외칠 시각을 흩뿌린 뒤 순서대로 정렬한다.
    const times = Array.from({ length: RIVALS }, () => FIRST_AT + this.rand() * (LAST_AT - FIRST_AT));
    times.sort((a, b) => a - b);
    // 서로 너무 붙어 있으면 사람이 비집고 들어갈 틈이 없다. 최소 간격을 준다.
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] < GAP * 2.4) times[i] = times[i - 1] + GAP * 2.4;
    }
    this.rivals = times.map((at, i) => ({ cast: i + 1, at, took: null }));
    this.setAt = t;
    this.nextNum = 1;
    this.myCall = null;
    this.ended = null;
    this.breakLeft = 0;
  }

  update(dt: number, t: number, input: FreeInput, audio: AudioEngine): void {
    if (this.setIdx >= SETS) {
      this.overT += dt;
      return;
    }

    // 판이 끝났으면 잠깐 보여주고 다음 판으로.
    if (this.ended) {
      this.breakLeft -= dt;
      if (this.breakLeft <= 0) {
        this.results.push(this.ended);
        this.setIdx++;
        if (this.setIdx < SETS) this.beginSet(t);
      }
      return;
    }

    const local = t - this.setAt;
    const now = audio.ctx.currentTime;

    // 내가 외쳤나 — 한 판에 한 번뿐이다.
    if (this.myCall === null && input.pressed('Space')) {
      this.myCall = local;
      // 아직 안 외친 사람 중 내 시각과 겹치는 사람이 있으면 둘 다 탈락.
      const clash = this.rivals.find((r) => r.took === null && Math.abs(r.at - local) < GAP);
      if (clash) {
        this.finishSet({ outcome: 'clash', num: 0 }, audio);
        return;
      }
      this.finishSet({ outcome: 'ok', num: this.nextNum }, audio);
      audio.blip(now, 880, 0.9, 'triangle');
      return;
    }

    // AI 가 외칠 차례
    for (const r of this.rivals) {
      if (r.took !== null || local < r.at) continue;
      r.took = this.nextNum;
      this.nextNum++;
      audio.blip(now, 400 + r.cast * 60, 0.5, 'sine');
    }

    // 다섯이 다 가져갔는데 나는 아직 — 꼴찌다.
    if (this.rivals.every((r) => r.took !== null)) {
      this.finishSet({ outcome: 'last', num: 0 }, audio);
    }
  }

  private finishSet(res: SetResult, audio: AudioEngine): void {
    this.ended = res;
    this.breakLeft = BREAK;
    const now = audio.ctx.currentTime;
    if (res.outcome === 'ok') audio.good(now);
    else audio.bad(now);
  }

  get done(): boolean {
    return this.setIdx >= SETS && this.overT > 1.4;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    const local = t - this.setAt;

    // 아직 안 외친 사람만 줄 세운다. 하나씩 빠져나가는 게 눈에 보여야 압박이 온다.
    const waiting = this.rivals.filter((r) => r.took === null);
    const shown = [{ cast: 0 } as { cast: number }, ...waiting];
    const gap = 132;
    const first = W / 2 - (gap * (shown.length - 1)) / 2;

    shown.forEach((p, i) => {
      const x = first + i * gap;
      const mine = p.cast === 0;
      const called = mine && this.myCall !== null;
      const since = called ? local - this.myCall! : 99;
      const pop = since < 0.6 ? easeOut(1 - since / 0.6, 2) : 0;

      drawCharacter(g, {
        id: CAST[p.cast],
        x,
        y: 392,
        h: mine ? 128 : 112,
        hop: pop * 20,
        squash: pop * 0.3,
        sing: pop,
        armL: pop > 0.2 ? -1 : 0,
        armR: pop > 0.2 ? -1 : 0,
        // 아직 아무도 안 외쳤으면 서로 눈치를 본다.
        look: this.ended ? 0 : Math.sin(t * 1.6 + p.cast * 1.9) * 0.85,
      });
      if (mine) text(g, '나', x, 428, { size: 15, color: C.pink, weight: 800 });
    });

    // 방금 빠져나간 사람들 — 아래에 가져간 숫자와 함께.
    const gone = this.rivals.filter((r) => r.took !== null);
    gone.forEach((r, i) => {
      const x = 60 + i * 58;
      g.save();
      g.globalAlpha = 0.55;
      drawCharacter(g, { id: CAST[r.cast], x, y: H - 34, h: 52 });
      g.restore();
      text(g, `${r.took}`, x, H - 20, { size: 13, color: C.inkSoft, weight: 800 });
    });

    // 지금 외치면 받는 숫자
    text(g, `${this.nextNum}`, W / 2, 96, { size: 62, color: this.ended ? C.inkSoft : C.ink });
    text(g, '지금 외치면 이 숫자', W / 2, 132, { size: 14, color: C.inkSoft, weight: 700 });

    text(g, `${this.setIdx + Math.min(1, this.ended ? 1 : 0)} / ${SETS} 판`, W - 30, 40, {
      size: 15,
      color: C.inkSoft,
      align: 'right',
      weight: 700,
    });
    // FreePlayScene 이 왼쪽 위(22, 30)에 게임 이름을 그리므로 한 줄 아래로 내린다.
    const sum = this.results.reduce((s, r) => s + r.num, 0);
    text(g, `합계 ${sum}`, 22, 58, { size: 15, color: C.ink, align: 'left', weight: 800 });

    // 안내 / 결과
    if (this.setIdx >= SETS) {
      text(g, '끝!', W / 2, 486, { size: 34, color: C.mint });
    } else if (this.ended) {
      const label =
        this.ended.outcome === 'ok'
          ? `${this.ended.num}번 차지!`
          : this.ended.outcome === 'clash'
            ? '겹쳤다!'
            : '꼴찌...';
      text(g, label, W / 2, 486, {
        size: 30,
        color: this.ended.outcome === 'ok' ? C.mint : C.pink,
        weight: 900,
      });
    } else {
      const pulse = 0.6 + Math.sin(t * 3) * 0.4;
      text(g, '늦을수록 큰 숫자 · 겹치면 0점', W / 2, 486, {
        size: 17,
        color: C.inkSoft,
        weight: 600,
        alpha: pulse,
      });
    }
  }

  result(): FreeResult {
    const sum = this.results.reduce((s, r) => s + r.num, 0);
    const wins = this.results.filter((r) => r.outcome === 'ok').length;
    const clashes = this.results.filter((r) => r.outcome === 'clash').length;
    return {
      score: sum * 100 + wins * 30,
      // 세 판 다 성공해서 합이 9 이상이면 배짱과 눈치가 둘 다 좋은 것이다.
      rank: sum >= 9 ? 'superb' : sum >= 4 ? 'ok' : 'again',
      headline: `숫자 합계 ${sum}`,
      rows: [
        { label: '성공', value: `${wins} / ${SETS}`, color: C.mint },
        { label: '숫자 합', value: sum, color: C.blue },
        { label: '겹침', value: clashes, color: C.pink },
      ],
    };
  }
}
