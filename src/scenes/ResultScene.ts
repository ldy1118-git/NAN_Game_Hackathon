import type { App, Scene } from '../core/App';
import { drawBackdrop } from '../minigames/stage';
import { C, H, W, circle, clamp, easeBack, easeOut, roundRect, shadowed, text } from '../core/draw';
import { RANK_LABEL, rankOf, type JudgeStats, type Rank } from '../core/types';
import { DIFFICULTY_LABEL, recordKey, type Difficulty } from '../core/difficulty';
import { Fx } from '../core/fx';
import { newSeed } from '../core/rng';
import { submit, type RecordUpdate } from '../core/records';
import type { FreeResult } from '../minigames/FreeGame';
import type { MiniGameEntry } from '../minigames';
import { DifficultyScene } from './DifficultyScene';
import { FreePlayScene } from './FreePlayScene';
import { MedleyScene } from './MedleyScene';
import { PlayScene } from './PlayScene';
import { MEDLEY, MEDLEY_ID, fromEntry } from './playable';
import type { RoundResult } from './round';

const RANK_COLOR: Record<Rank, string> = {
  again: C.inkSoft,
  ok: C.blue,
  superb: C.pink,
};

const RANK_NOTE: Record<Rank, string> = {
  again: '박자를 놓쳤어요. 한 번 더!',
  ok: '나쁘지 않아요. 조금만 더 정확하게.',
  superb: '완벽하게 맞췄어요!',
};

const FREE_NOTE: Record<Rank, string> = {
  again: '아쉬워요. 한 번 더!',
  ok: '좋아요. 조금만 더.',
  superb: '훌륭합니다!',
};

const MEDLEY_NOTE: Record<Rank, string> = {
  again: '전환을 따라가지 못했어요. 다시!',
  ok: '끝까지 갔습니다. 이제 정확도.',
  superb: '전부 손에 익었네요!',
};

/**
 * 결과 화면이 그리는 것. 리듬·자유형·종합게임이 서로 다른 방식으로 만들어 넘긴다.
 *
 * 결과 화면을 세 벌 만들지 않으려고 한 단계 추상화했다. 리듬 쪽 판정 내역
 * (완벽/좋음/놓침/헛침)을 자유형 게임에 억지로 끼우면 0만 잔뜩 뜬다.
 */
interface Summary {
  rank: Rank;
  note: string;
  /** 등급 아래 크게 뜨는 한 줄. */
  headline: string;
  rows: { label: string; value: string | number; color: string }[];
  /** 종합게임 전용 — 판별 결과를 알약으로 늘어놓는다. */
  rounds?: RoundResult[];
}

/** 다시하기·나가기가 어디로 갈지. 갈래마다 다르므로 만들 때 정해 둔다. */
interface Exits {
  replay(seed: number): Scene;
  back(): Scene;
}

export class ResultScene implements Scene {
  private title: string;
  private difficulty: Difficulty;
  private summary: Summary;
  private record: RecordUpdate;
  private exits: Exits;
  private t = 0;
  private off: (() => void) | null = null;
  /** 잘한 판에 뿌리는 색종이. 장식이라 결과값에는 손대지 않는다. */
  private fx = new Fx();

  private constructor(
    title: string,
    difficulty: Difficulty,
    summary: Summary,
    record: RecordUpdate,
    exits: Exits,
  ) {
    this.title = title;
    this.difficulty = difficulty;
    this.summary = summary;
    this.record = record;
    this.exits = exits;
  }

  /** 리듬 게임의 결과. */
  static fromRhythm(
    entry: MiniGameEntry,
    difficulty: Difficulty,
    stats: JudgeStats,
    bestCombo: number,
  ): ResultScene {
    const rank = rankOf(stats);
    const summary: Summary = {
      rank,
      note: RANK_NOTE[rank],
      headline: `최대 콤보 ${bestCombo} / ${stats.total}`,
      rows: [
        { label: '완벽', value: stats.perfect, color: C.mint },
        { label: '좋음', value: stats.good, color: C.blue },
        { label: '놓침', value: stats.miss, color: C.inkSoft },
        { label: '헛침', value: stats.whiff, color: C.yellow },
      ],
    };
    // 결과를 만드는 시점에 바로 기록한다. 여기서 나가는 경로가 여럿이라
    // exit 에서 하면 빠지는 길이 생긴다.
    const record = submit(recordKey(entry.id, difficulty), stats, bestCombo);
    return new ResultScene(entry.title, difficulty, summary, record, gameExits(entry, difficulty));
  }

  /** 자유형 게임의 결과. */
  static fromFree(entry: MiniGameEntry, difficulty: Difficulty, r: FreeResult): ResultScene {
    const summary: Summary = {
      rank: r.rank,
      note: FREE_NOTE[r.rank],
      headline: r.headline,
      rows: r.rows,
    };
    // 판정 내역이 없으므로 점수 하나만 기록에 남긴다.
    const stats: JudgeStats = { perfect: 0, good: 0, miss: 0, whiff: 0, total: 0 };
    const record = submit(recordKey(entry.id, difficulty), stats, r.score, r.rank);
    return new ResultScene(entry.title, difficulty, summary, record, gameExits(entry, difficulty));
  }

  /**
   * 종합게임의 결과.
   *
   * 판마다 점수 체계가 다르므로(콤보·초·개수) 등급만 공통 화폐로 쓴다.
   * 등급을 점수로 바꿔 합치면 "열 판을 고르게 잘했나"가 한 숫자로 나온다.
   */
  static fromMedley(difficulty: Difficulty, rounds: RoundResult[]): ResultScene {
    const total = rounds.reduce((s, r) => s + RANK_POINTS[r.rank], 0);
    const avg = rounds.length > 0 ? total / rounds.length : 0;
    const rank: Rank = avg >= 85 ? 'superb' : avg >= 55 ? 'ok' : 'again';
    const count = (k: Rank): number => rounds.filter((r) => r.rank === k).length;

    const summary: Summary = {
      rank,
      note: MEDLEY_NOTE[rank],
      headline: `${rounds.length}판 · 평균 ${Math.round(avg)}점`,
      rows: [
        { label: '완벽', value: count('superb'), color: C.pink },
        { label: '그럭저럭', value: count('ok'), color: C.blue },
        { label: '처음부터', value: count('again'), color: C.inkSoft },
        { label: '합계', value: total, color: C.mint },
      ],
      rounds,
    };
    const stats: JudgeStats = { perfect: 0, good: 0, miss: 0, whiff: 0, total: 0 };
    const record = submit(recordKey(MEDLEY_ID, difficulty), stats, total, rank);
    return new ResultScene(MEDLEY.title, difficulty, summary, record, {
      replay: (seed) => new MedleyScene(difficulty, seed),
      back: () => new DifficultyScene(MEDLEY),
    });
  }

  enter(app: App): void {
    const now = app.actx.currentTime;
    const rank = this.summary.rank;
    if (rank === 'again') {
      app.audio.bad(now);
      app.audio.bad(now + 0.16);
    } else {
      // 등급이 높을수록 위로 더 뻗는 아르페지오.
      const notes = rank === 'superb' ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
      notes.forEach((f, i) => app.audio.blip(now + i * 0.09, f, 0.8, 'triangle'));
      app.audio.kick(now, 0.7);
      // 최고 등급은 색종이까지. 아무 판에나 뿌리면 축하가 값싸진다.
      if (rank === 'superb') this.fx.confetti(W, 90);
    }

    this.off = app.input.onUiKey((code) => {
      // 씨앗은 매번 새로 만든다. 같은 씨앗으로 다시 시작하면 똑같은 채보가 나와서
      // 두 판째부터는 반응이 아니라 암기로 치게 된다.
      if (code === 'Space' || code === 'Enter') app.setScene(this.exits.replay(newSeed()));
      else if (code === 'Escape') app.setScene(this.exits.back());
    });
  }

  exit(): void {
    this.off?.();
  }

  update(dt: number): void {
    this.t += dt;
    this.fx.update(dt);
    // 카드 숫자가 다 올라간 순간 신기록이면 한 번 더 뿌린다.
    if (this.record.improved.rank || this.record.improved.combo) {
      if (this.t >= COUNT_SEC && this.t - dt < COUNT_SEC) this.fx.confetti(W, 40);
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    drawBackdrop(g, this.t * 1.4);

    const { rank, note, headline, rows, rounds } = this.summary;
    const color = RANK_COLOR[rank];

    g.save();
    g.globalAlpha = 0.12;
    g.fillStyle = color;
    circle(g, W / 2, 172, 90 + Math.sin(this.t * 2.4) * 7);
    g.fill();
    g.restore();

    text(g, `${this.title} · ${DIFFICULTY_LABEL[this.difficulty]}`, W / 2, 58, {
      size: 17,
      color: C.inkSoft,
      weight: 600,
    });

    // 등급 — 튀어오르며 등장.
    const pop = easeBack(Math.min(this.t / 0.45, 1));
    g.save();
    g.translate(W / 2, 178);
    g.scale(pop, pop);
    text(g, RANK_LABEL[rank], 0, 0, { size: 64, color });
    g.restore();

    g.save();
    g.globalAlpha = easeOut(Math.min(Math.max(this.t - 0.35, 0) / 0.4, 1), 2);
    text(g, note, W / 2, 232, { size: 17, color: C.inkSoft, weight: 500 });

    // 항목 카드 — 개수에 맞춰 폭을 나눈다.
    const gap = 14;
    const bw = Math.min(132, (560 - (rows.length - 1) * gap) / Math.max(rows.length, 1));
    const total = rows.length * bw + (rows.length - 1) * gap;
    rows.forEach((row, i) => {
      const x = W / 2 - total / 2 + i * (bw + gap);
      // 카드가 하나씩 차례로 올라온다. 다 같이 나타나면 읽을 순서가 안 생긴다.
      const rise = easeOut(clamp((this.t - 0.45 - i * 0.09) / 0.4, 0, 1), 3);
      g.save();
      g.globalAlpha = rise;
      g.translate(0, (1 - rise) * 14);
      shadowed(g, () => roundRect(g, x, 268, bw, 78, 16), C.white, 4);
      text(g, countUp(row.value, this.t), x + bw / 2, 298, { size: 28, color: row.color });
      text(g, row.label, x + bw / 2, 330, { size: 13, color: C.inkSoft, weight: 600 });
      g.restore();
    });

    text(g, headline, W / 2, 376, { size: 18, color: C.ink, weight: 700 });
    if (rounds) this.drawRounds(g, rounds);
    this.drawRecord(g, rounds ? 460 : 420);
    g.restore();

    this.fx.draw(g);

    const blink = 0.55 + Math.sin(this.t * 4) * 0.35;
    text(g, '스페이스로 다시하기 · Esc 로 난이도 목록', W / 2, H - 28, {
      size: 15,
      color: C.ink,
      weight: 600,
      alpha: blink,
    });
  }

  /**
   * 종합게임의 판별 성적.
   *
   * 합계 하나만 보여주면 어느 게임에서 무너졌는지 알 수 없다. 판마다 알약을
   * 하나씩 늘어놓고 등급으로 색을 칠하면, 다음에 뭘 연습해야 하는지가 보인다.
   */
  private drawRounds(g: CanvasRenderingContext2D, rounds: RoundResult[]): void {
    const y = 408;
    const gap = 8;
    const bw = Math.min(104, (W - 80 - (rounds.length - 1) * gap) / rounds.length);
    const total = rounds.length * bw + (rounds.length - 1) * gap;

    rounds.forEach((r, i) => {
      const x = W / 2 - total / 2 + i * (bw + gap);
      const color = RANK_COLOR[r.rank];
      g.fillStyle = r.rank === 'again' ? 'rgba(43, 42, 51, 0.1)' : color;
      roundRect(g, x, y, bw, 30, 9);
      g.fill();
      text(g, r.entry.title, x + bw / 2, y + 15, {
        size: bw > 90 ? 12 : 10,
        color: r.rank === 'again' ? C.inkSoft : C.white,
        weight: 800,
      });
    });
  }

  /**
   * 기록 줄 — 뭔가 갱신했으면 그걸, 아니면 지금까지의 최고를 보여준다.
   *
   * 갱신했을 때만 알려주면 갱신 못 한 판은 비교 대상이 사라진다.
   * "얼마나 모자랐는지"가 보여야 다시 할 마음이 든다.
   */
  private drawRecord(g: CanvasRenderingContext2D, y: number): void {
    const { previous, improved, allPerfect } = this.record;

    if (allPerfect) {
      const pulse = 0.75 + Math.sin(this.t * 5) * 0.25;
      text(g, '★ 올 퍼펙트 ★', W / 2, y, { size: 21, color: C.pink, weight: 900, alpha: pulse });
      return;
    }

    if (!previous) {
      text(g, '이 난이도의 첫 기록이 저장됐습니다', W / 2, y, {
        size: 16,
        color: C.inkSoft,
        weight: 600,
      });
      return;
    }

    const news: string[] = [];
    if (improved.rank) news.push('등급');
    if (improved.combo) news.push('기록');

    if (news.length > 0) {
      const pulse = 0.7 + Math.sin(this.t * 5) * 0.3;
      text(g, `신기록! ${news.join(' · ')}`, W / 2, y, {
        size: 19,
        color: C.pink,
        weight: 800,
        alpha: pulse,
      });
      return;
    }

    text(g, `이 난이도 최고 — ${RANK_LABEL[previous.rank]} · ${previous.combo}`, W / 2, y, {
      size: 15,
      color: C.inkSoft,
      weight: 600,
    });
  }
}

/** 등급을 점수로. 판마다 규칙이 달라서 등급만이 공통 화폐다. */
const RANK_POINTS: Record<Rank, number> = { superb: 100, ok: 60, again: 20 };

/** 숫자가 0에서 제 값까지 올라가는 데 걸리는 시간(초). */
const COUNT_SEC = 1.1;

/**
 * 숫자를 0부터 굴려 올린다.
 *
 * 최종값만 띡 찍어 놓으면 눈이 안 간다. 1초 남짓 굴러 올라가는 것만으로 결과
 * 화면을 "기다리게" 되고, 그 사이에 카드들이 차례로 올라오는 게 보인다.
 * 문자열 값(예: '25초')은 굴릴 게 없으므로 그대로 둔다.
 */
function countUp(value: string | number, t: number): string {
  if (typeof value !== 'number') return value;
  if (t >= COUNT_SEC) return String(value);
  const p = easeOut(Math.max(t - 0.5, 0) / (COUNT_SEC - 0.5), 3);
  return String(Math.round(value * p));
}

/** 미니게임 한 판의 나가는 길. 같은 난이도로 다시, 또는 난이도 목록으로. */
function gameExits(entry: MiniGameEntry, difficulty: Difficulty): Exits {
  return {
    replay: (seed) =>
      entry.kind === 'free'
        ? new FreePlayScene(entry, difficulty, seed)
        : new PlayScene(entry, difficulty, seed),
    back: () => new DifficultyScene(fromEntry(entry)),
  };
}
