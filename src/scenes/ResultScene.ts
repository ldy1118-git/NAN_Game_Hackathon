import type { App, Scene } from '../core/App';
import { C, H, W, circle, easeBack, easeOut, roundRect, shadowed, text } from '../core/draw';
import { RANK_LABEL, rankOf, type JudgeStats, type Rank } from '../core/types';
import type { MiniGameEntry } from '../minigames';
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

export class ResultScene implements Scene {
  private entry: MiniGameEntry;
  private stats: JudgeStats;
  private bestCombo: number;
  private rank: Rank;
  private t = 0;
  private off: (() => void) | null = null;

  constructor(entry: MiniGameEntry, stats: JudgeStats, bestCombo: number) {
    this.entry = entry;
    this.stats = stats;
    this.bestCombo = bestCombo;
    this.rank = rankOf(stats);
  }

  enter(app: App): void {
    const now = app.actx.currentTime;
    if (this.rank === 'again') {
      app.audio.bad(now);
      app.audio.bad(now + 0.16);
    } else {
      // 등급이 높을수록 위로 더 뻗는 아르페지오.
      const notes = this.rank === 'superb' ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
      notes.forEach((f, i) => app.audio.blip(now + i * 0.09, f, 0.8, 'triangle'));
      app.audio.kick(now, 0.7);
    }
    this.off = app.input.onUiKey((code) => {
      if (code === 'Space' || code === 'Enter') app.setScene(new PlayScene(this.entry));
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

    const color = RANK_COLOR[this.rank];

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
    text(g, RANK_LABEL[this.rank], 0, 0, { size: 68, color });
    g.restore();

    g.save();
    g.globalAlpha = easeOut(Math.min(Math.max(this.t - 0.35, 0) / 0.4, 1), 2);
    text(g, RANK_NOTE[this.rank], W / 2, 254, { size: 17, color: C.inkSoft, weight: 500 });

    // 판정 내역
    const rows: [string, number, string][] = [
      ['완벽', this.stats.perfect, C.mint],
      ['좋음', this.stats.good, C.blue],
      ['놓침', this.stats.miss, C.inkSoft],
      ['헛침', this.stats.whiff, C.yellow],
    ];
    const bw = 132;
    const gap = 14;
    const total = rows.length * bw + (rows.length - 1) * gap;
    rows.forEach(([label, value, c], i) => {
      const x = W / 2 - total / 2 + i * (bw + gap);
      shadowed(g, () => roundRect(g, x, 300, bw, 84, 16), C.white, 4);
      text(g, String(value), x + bw / 2, 334, { size: 32, color: c });
      text(g, label, x + bw / 2, 366, { size: 14, color: C.inkSoft, weight: 600 });
    });

    text(g, `최대 콤보 ${this.bestCombo} / ${this.stats.total}`, W / 2, 424, {
      size: 18,
      color: C.ink,
      weight: 700,
    });
    g.restore();

    const blink = 0.55 + Math.sin(this.t * 4) * 0.35;
    text(g, '스페이스로 다시하기 · Esc 로 목록', W / 2, H - 46, {
      size: 16,
      color: C.ink,
      weight: 600,
      alpha: blink,
    });
  }
}
