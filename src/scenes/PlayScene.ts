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

/** 재개할 때 세어주는 박 수. 손이 다시 박자에 올라탈 시간을 준다. */
const RESUME_COUNT = 3;

type Phase = 'playing' | 'paused' | 'resuming';

export class PlayScene implements Scene {
  private app!: App;
  private runner!: Runner;
  private entry: MiniGameEntry;
  private off: (() => void) | null = null;
  private done = false;
  private phase: Phase = 'playing';
  /** 재개 카운트다운에 남은 시간(초). 박자와 무관한 연출이라 벽시계로 센다. */
  private resumeLeft = 0;

  constructor(entry: MiniGameEntry) {
    this.entry = entry;
  }

  enter(app: App): void {
    this.app = app;
    const game = this.entry.create();
    // 리드인을 넉넉히 둬서 스케줄러가 첫 마디를 미리 채울 시간을 준다.
    app.conductor.start(game.bpm, 1.4);
    this.runner = new Runner(game, app.conductor, app.audio, app.input);
    this.off = app.input.onUiKey((code) => this.onKey(code));
  }

  exit(): void {
    this.off?.();
    this.app.conductor.stop();
  }

  private onKey(code: string): void {
    if (this.done) return;
    if (this.phase === 'playing') {
      // Esc 가 곧바로 타이틀이면 실수로 한 판이 날아간다. 먼저 멈추고 묻는다.
      if (code === 'Escape') this.pause();
      return;
    }
    if (code === 'Escape') {
      this.app.setScene(new TitleScene());
    } else if (code === 'Space' || code === 'Enter') {
      this.startResume();
    }
  }

  /**
   * 탭이 백그라운드로 갔거나 루프가 오래 멈췄다 돌아왔을 때 App 이 부른다.
   * 이미 멈춰 있으면 아무 일도 하지 않는다.
   */
  onStall(gapSec: number): void {
    if (this.done || this.phase === 'paused') return;
    this.pause(gapSec);
  }

  private pause(rewindSec = 0): void {
    this.app.conductor.pause(rewindSec);
    // 누르고 있던 hold 를 놓아주고, 멈춘 뒤로 걸린 예약을 되돌린다.
    this.runner.interrupt();
    this.app.input.clear();
    this.phase = 'paused';
  }

  private startResume(): void {
    this.resumeLeft = RESUME_COUNT * this.app.conductor.secPerBeat;
    this.phase = 'resuming';
  }

  update(dt: number): void {
    if (this.done) return;

    if (this.phase === 'paused') return;

    if (this.phase === 'resuming') {
      // 카운트다운 동안에도 시간은 멈춰 있다 — 판정도 예약도 돌지 않는다.
      this.resumeLeft -= dt;
      if (this.resumeLeft > 0) return;
      this.app.conductor.resume();
      // 멈춰 있는 동안 눌린 키가 재개 직후 판정으로 새는 걸 막는다.
      this.app.input.clear();
      this.phase = 'playing';
    }

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
    if (this.phase !== 'playing') this.drawPauseOverlay(g);
  }

  /** 멈춤·재개 화면. 게임 위에 반투명하게 덮는다. */
  private drawPauseOverlay(g: CanvasRenderingContext2D): void {
    g.save();
    g.fillStyle = 'rgba(250, 245, 235, 0.86)';
    g.fillRect(0, 0, W, H);

    if (this.phase === 'resuming') {
      const n = Math.max(1, Math.ceil(this.resumeLeft / this.app.conductor.secPerBeat));
      // 숫자가 바뀔 때마다 한 번 크게 튀었다가 가라앉는다.
      const within = this.resumeLeft / this.app.conductor.secPerBeat;
      const pop = easeOut(1 - (within - Math.floor(within)), 3);
      text(g, `${n}`, W / 2, H / 2 - 10, {
        size: 92 + pop * 26,
        color: C.pink,
      });
      text(g, '준비하세요', W / 2, H / 2 + 66, {
        size: 18,
        color: C.inkSoft,
        weight: 600,
      });
      g.restore();
      return;
    }

    text(g, '일시정지', W / 2, H / 2 - 46, { size: 46, color: C.ink });
    text(g, '스페이스로 이어서 · Esc 로 나가기', W / 2, H / 2 + 14, {
      size: 18,
      color: C.inkSoft,
      weight: 600,
    });

    const s = this.runner.stats;
    text(g, `완벽 ${s.perfect} · 좋음 ${s.good} · 놓침 ${s.miss}`, W / 2, H / 2 + 62, {
      size: 15,
      color: C.inkSoft,
      weight: 500,
      alpha: 0.8,
    });
    g.restore();
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
