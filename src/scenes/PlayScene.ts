import type { App, Scene } from '../core/App';
import { Runner } from '../core/Runner';
import { C, H, W, beatPulse, clamp, easeOut, text } from '../core/draw';
import { VERDICT_LABEL, type Verdict } from '../core/types';
import type { MiniGameEntry } from '../minigames';
import { ResultScene } from './ResultScene';
import { TitleScene } from './TitleScene';

/** 판정 문구의 기본 높이. 게임이 `verdictY` 로 덮어쓸 수 있다. */
const DEFAULT_VERDICT_Y = 176;
/** 판정 문구 아래에 "조금 늦음"을 띄우는 간격. */
const ERR_TEXT_GAP = 32;

const VERDICT_COLOR: Record<Verdict, string> = {
  perfect: C.mint,
  good: C.blue,
  miss: C.inkSoft,
};

export class PlayScene implements Scene {
  private app!: App;
  private runner!: Runner;
  private entry: MiniGameEntry;
  private off: (() => void) | null = null;
  private done = false;

  constructor(entry: MiniGameEntry) {
    this.entry = entry;
  }

  enter(app: App): void {
    this.app = app;
    const game = this.entry.create();
    // 리드인을 넉넉히 둬서 스케줄러가 첫 마디를 미리 채울 시간을 준다.
    app.conductor.start(game.bpm, 1.4);
    this.runner = new Runner(game, app.conductor, app.audio, app.input);
    this.off = app.input.onUiKey((code) => {
      if (code === 'Escape') app.setScene(new TitleScene());
    });
  }

  exit(): void {
    this.off?.();
    this.app.conductor.stop();
  }

  update(): void {
    if (this.done) return;
    this.runner.update();
    if (this.runner.finished) {
      this.done = true;
      this.app.setScene(
        new ResultScene(this.entry, this.runner.stats, this.runner.bestCombo),
      );
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    const beat = this.app.conductor.beat;
    const game = this.runner.game;

    // 화면 전체가 정박에 아주 살짝 부푼다. 1% 남짓이지만 "딱딱 맞는" 감각의 절반은 여기서 온다.
    const pulse = beat > 0 ? beatPulse(beat, 6) : 0;
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(1 + pulse * 0.009, 1 + pulse * 0.009);
    g.translate(-W / 2, -H / 2);

    game.draw(g, {
      beat,
      events: this.runner.events,
      stats: this.runner.stats,
      lastJudge: this.runner.lastJudge,
      combo: this.runner.combo,
    });

    g.restore();

    this.drawHud(g, beat);
  }

  private drawHud(g: CanvasRenderingContext2D, beat: number): void {
    const game = this.runner.game;

    // 진행 막대
    const p = clamp(beat / game.endBeat, 0, 1);
    g.fillStyle = 'rgba(43, 42, 51, 0.1)';
    g.fillRect(0, 0, W, 6);
    g.fillStyle = C.pink;
    g.fillRect(0, 0, W * p, 6);

    text(g, game.title, 22, 30, {
      size: 17,
      color: C.inkSoft,
      align: 'left',
      weight: 700,
      alpha: 0.7,
    });

    // 콤보 — 3부터 보여준다. 정박이 아니라 "쳤을 때" 튄다.
    if (this.runner.combo >= 3) {
      const lj = this.runner.lastJudge;
      const age = lj ? beat - lj.atBeat : 99;
      const pop = age < 0.4 ? easeOut(1 - age / 0.4, 3) : 0;
      text(g, `${this.runner.combo}`, W - 30, 34, {
        size: 34 + pop * 12,
        color: C.pink,
        align: 'right',
      });
      text(g, 'COMBO', W - 30, 60, {
        size: 11,
        color: C.inkSoft,
        align: 'right',
        weight: 700,
      });
    }

    this.drawVerdict(g, beat);
  }

  /** 판정 문구 — 위로 떠오르며 사라진다. */
  private drawVerdict(g: CanvasRenderingContext2D, beat: number): void {
    const lj = this.runner.lastJudge;
    if (!lj) return;
    const age = beat - lj.atBeat;
    if (age < 0 || age > 1.1) return;

    const t = age / 1.1;
    const rise = easeOut(t, 2) * 26;
    // 게임이 화면 위쪽을 쓰면 기본 자리에서 그림과 겹친다. 그럴 땐 게임이 옮긴다.
    const top = this.runner.game.verdictY ?? DEFAULT_VERDICT_Y;
    g.save();
    g.globalAlpha = 1 - t * t;
    text(g, VERDICT_LABEL[lj.verdict], W / 2, top - rise, {
      size: 38 + (1 - Math.min(t * 4, 1)) * 12,
      color: VERDICT_COLOR[lj.verdict],
    });
    g.restore();

    // 완벽이 아닐 때만 얼마나 어긋났는지 알려준다 — 연습에 직접 도움이 되는 정보.
    if (lj.verdict !== 'perfect' && lj.ev.pressedBeat !== undefined) {
      const errMs = (lj.ev.pressedBeat - lj.ev.beat) * this.app.conductor.secPerBeat * 1000;
      if (Math.abs(errMs) < 400) {
        g.save();
        g.globalAlpha = (1 - t) * 0.8;
        text(g, errMs > 0 ? '조금 늦음' : '조금 빠름', W / 2, top + ERR_TEXT_GAP - rise, {
          size: 15,
          color: C.inkSoft,
          weight: 600,
        });
        g.restore();
      }
    }
  }
}
