import type { App, Scene } from '../core/App';
import { C, H, W, circle, easeBack, easeOut, roundRect, shadowed, text } from '../core/draw';
import { RANK_LABEL, rankOf, type JudgeStats, type Rank } from '../core/types';
import { submit, type RecordUpdate } from '../core/records';
import type { FreeResult } from '../minigames/FreeGame';
import type { MiniGameEntry } from '../minigames';
import { FreePlayScene } from './FreePlayScene';
import { PlayScene } from './PlayScene';
import { TitleScene } from './TitleScene';

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

/**
 * 결과 화면이 그리는 것. 리듬 게임과 자유형 게임이 서로 다른 방식으로 만들어 넘긴다.
 *
 * 결과 화면을 두 벌 만들지 않으려고 한 단계 추상화했다. 리듬 쪽 판정 내역
 * (완벽/좋음/놓침/헛침)을 자유형 게임에 억지로 끼우면 0만 잔뜩 뜬다.
 */
interface Summary {
  rank: Rank;
  note: string;
  /** 등급 아래 크게 뜨는 한 줄. */
  headline: string;
  rows: { label: string; value: string | number; color: string }[];
  /** 기록에 남길 값. 리듬은 콤보, 자유형은 점수. */
  scoreForRecord: number;
}

export class ResultScene implements Scene {
  private entry: MiniGameEntry;
  private summary: Summary;
  private t = 0;
  private off: (() => void) | null = null;
  private record: RecordUpdate;

  private constructor(entry: MiniGameEntry, summary: Summary, record: RecordUpdate) {
    this.entry = entry;
    this.summary = summary;
    this.record = record;
  }

  /** 리듬 게임의 결과. */
  static fromRhythm(entry: MiniGameEntry, stats: JudgeStats, bestCombo: number): ResultScene {
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
      scoreForRecord: bestCombo,
    };
    // 결과를 만드는 시점에 바로 기록한다. 여기서 나가는 경로가 여럿이라
    // exit 에서 하면 빠지는 길이 생긴다.
    return new ResultScene(entry, summary, submit(entry.id, stats, bestCombo));
  }

  /** 자유형 게임의 결과. */
  static fromFree(entry: MiniGameEntry, r: FreeResult): ResultScene {
    const summary: Summary = {
      rank: r.rank,
      note: FREE_NOTE[r.rank],
      headline: r.headline,
      rows: r.rows,
      scoreForRecord: r.score,
    };
    // 판정 내역이 없으므로 점수 하나만 기록에 남긴다.
    const stats: JudgeStats = { perfect: 0, good: 0, miss: 0, whiff: 0, total: 0 };
    return new ResultScene(entry, summary, submit(entry.id, stats, r.score, r.rank));
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
    }
    this.off = app.input.onUiKey((code) => {
      if (code === 'Space' || code === 'Enter') app.setScene(replay(this.entry));
      else if (code === 'Escape') app.setScene(new TitleScene());
    });
  }

  exit(): void {
    this.off?.();
  }

  update(dt: number): void {
    this.t += dt;
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    const { rank, note, headline, rows } = this.summary;
    const color = RANK_COLOR[rank];

    g.save();
    g.globalAlpha = 0.12;
    g.fillStyle = color;
    circle(g, W / 2, 190, 98 + Math.sin(this.t * 2.4) * 7);
    g.fill();
    g.restore();

    text(g, this.entry.title, W / 2, 76, { size: 18, color: C.inkSoft, weight: 600 });

    // 등급 — 튀어오르며 등장.
    const pop = easeBack(Math.min(this.t / 0.45, 1));
    g.save();
    g.translate(W / 2, 196);
    g.scale(pop, pop);
    text(g, RANK_LABEL[rank], 0, 0, { size: 68, color });
    g.restore();

    g.save();
    g.globalAlpha = easeOut(Math.min(Math.max(this.t - 0.35, 0) / 0.4, 1), 2);
    text(g, note, W / 2, 254, { size: 17, color: C.inkSoft, weight: 500 });

    // 항목 카드 — 개수에 맞춰 폭을 나눈다.
    const gap = 14;
    const bw = Math.min(132, (560 - (rows.length - 1) * gap) / Math.max(rows.length, 1));
    const total = rows.length * bw + (rows.length - 1) * gap;
    rows.forEach((row, i) => {
      const x = W / 2 - total / 2 + i * (bw + gap);
      shadowed(g, () => roundRect(g, x, 300, bw, 84, 16), C.white, 4);
      text(g, String(row.value), x + bw / 2, 334, { size: 30, color: row.color });
      text(g, row.label, x + bw / 2, 366, { size: 14, color: C.inkSoft, weight: 600 });
    });

    text(g, headline, W / 2, 420, { size: 18, color: C.ink, weight: 700 });
    this.drawRecord(g);
    g.restore();

    const blink = 0.55 + Math.sin(this.t * 4) * 0.35;
    text(g, '스페이스로 다시하기 · Esc 로 목록', W / 2, H - 46, {
      size: 16,
      color: C.ink,
      weight: 600,
      alpha: blink,
    });
  }

  /**
   * 기록 줄 — 뭔가 갱신했으면 그걸, 아니면 지금까지의 최고를 보여준다.
   *
   * 갱신했을 때만 알려주면 갱신 못 한 판은 비교 대상이 사라진다.
   * "얼마나 모자랐는지"가 보여야 다시 할 마음이 든다.
   */
  private drawRecord(g: CanvasRenderingContext2D): void {
    const { previous, improved, allPerfect } = this.record;
    const y = 456;

    if (allPerfect) {
      const pulse = 0.75 + Math.sin(this.t * 5) * 0.25;
      text(g, '★ 올 퍼펙트 ★', W / 2, y, { size: 21, color: C.pink, weight: 900, alpha: pulse });
      return;
    }

    if (!previous) {
      text(g, '첫 기록이 저장됐습니다', W / 2, y, { size: 16, color: C.inkSoft, weight: 600 });
      return;
    }

    const news: string[] = [];
    if (improved.rank) news.push('등급');
    if (improved.combo) news.push(this.entry.kind === 'free' ? '점수' : '콤보');
    if (improved.perfect && this.entry.kind === 'rhythm') news.push('완벽');

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

    const label =
      this.entry.kind === 'free'
        ? `최고 기록 — ${RANK_LABEL[previous.rank]} · ${previous.combo}점`
        : `최고 기록 — ${RANK_LABEL[previous.rank]} · 콤보 ${previous.combo} · 완벽 ${previous.perfect}`;
    text(g, label, W / 2, y, { size: 15, color: C.inkSoft, weight: 600 });
  }
}

const FREE_NOTE: Record<Rank, string> = {
  again: '아쉬워요. 한 번 더!',
  ok: '좋아요. 조금만 더.',
  superb: '훌륭합니다!',
};

/** 같은 게임을 다시 시작한다. 갈래에 맞는 씬을 고른다. */
function replay(entry: MiniGameEntry): Scene {
  return entry.kind === 'free' ? new FreePlayScene(entry) : new PlayScene(entry);
}
