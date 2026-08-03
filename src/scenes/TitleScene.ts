import type { App, Scene } from '../core/App';
import { C, H, W, beatPulse, circle, easeOut, roundRect, shadowed, text } from '../core/draw';
import { MINIGAMES } from '../minigames';
import { drawBeatDots } from '../minigames/stage';
import { CalibrationScene } from './CalibrationScene';
import { PlayScene } from './PlayScene';

const MENU_BPM = 112;
/** 타이틀 화면은 예약을 아주 짧게만 걸어둔다 — 게임 시작 직후까지 소리가 새지 않도록. */
const TITLE_LOOKAHEAD = 0.08;

export class TitleScene implements Scene {
  private app!: App;
  private cursor = 0;
  private nextStep = 0;
  private off: (() => void) | null = null;
  /** 커서가 움직인 박 — 항목이 튀어오르는 애니메이션의 기준. */
  private movedAt = -99;

  private get items(): string[] {
    return [...MINIGAMES.map((m) => m.title), '타이밍 맞추기'];
  }

  enter(app: App): void {
    this.app = app;
    app.conductor.start(MENU_BPM, 0.25);
    this.off = app.input.onUiKey((code) => this.onKey(code));
  }

  exit(): void {
    this.off?.();
  }

  private onKey(code: string): void {
    const n = this.items.length;
    if (code === 'ArrowDown' || code === 'KeyS') {
      this.cursor = (this.cursor + 1) % n;
      this.movedAt = this.app.conductor.beat;
      this.app.audio.blip(this.app.actx.currentTime, 523.25, 0.5, 'square');
    } else if (code === 'ArrowUp' || code === 'KeyW') {
      this.cursor = (this.cursor + n - 1) % n;
      this.movedAt = this.app.conductor.beat;
      this.app.audio.blip(this.app.actx.currentTime, 523.25, 0.5, 'square');
    } else if (code === 'Space' || code === 'Enter') {
      this.app.audio.good(this.app.actx.currentTime);
      if (this.cursor < MINIGAMES.length) {
        this.app.setScene(new PlayScene(MINIGAMES[this.cursor]));
      } else {
        this.app.setScene(new CalibrationScene());
      }
    }
  }

  update(): void {
    // 메뉴에서도 그루브가 돈다 — 들어오자마자 박자에 몸을 맞추게 하려고.
    const c = this.app.conductor;
    const horizon = c.scheduleBeat + TITLE_LOOKAHEAD / c.secPerBeat;
    while (this.nextStep * 0.5 <= horizon) {
      const t = c.beatToCtxTime(this.nextStep * 0.5);
      const inBar = this.nextStep % 8;
      if (inBar === 0 || inBar === 6) this.app.audio.kick(t, 0.55);
      if (inBar === 4) this.app.audio.snare(t, 0.4);
      this.app.audio.hat(t, inBar % 2 === 1 ? 0.35 : 0.18);
      this.nextStep++;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    const beat = this.app.conductor.beat;
    const pulse = beatPulse(beat, 5);
    const barPulse = beatPulse(beat / 4, 6);

    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalAlpha = barPulse * 0.35;
    g.fillStyle = C.white;
    g.fillRect(0, 0, W, H);
    g.restore();

    // 배경에서 박자에 맞춰 부푸는 원
    g.save();
    g.globalAlpha = 0.1;
    g.fillStyle = C.blue;
    circle(g, 150, 130, 90 + pulse * 14);
    g.fill();
    g.fillStyle = C.pink;
    circle(g, 830, 430, 110 + beatPulse(beat + 0.5, 5) * 16);
    g.fill();
    g.restore();

    // 제목 — 정박에 살짝 커진다.
    g.save();
    g.translate(W / 2, 108);
    g.scale(1 + pulse * 0.035, 1 + pulse * 0.035);
    text(g, 'NAN GAME', 0, 0, { size: 58, color: C.ink });
    g.restore();
    text(g, '박자에 맞춰 누르는 리듬 미니게임', W / 2, 152, {
      size: 17,
      color: C.inkSoft,
      weight: 500,
    });

    // 메뉴
    const items = this.items;
    items.forEach((label, i) => {
      const sel = i === this.cursor;
      const y = 226 + i * 74;
      const since = beat - this.movedAt;
      const pop = sel && since < 0.5 ? easeOut(1 - since / 0.5, 3) : 0;
      const w = 420 + (sel ? 26 : 0) + pop * 14;
      const h = 58;
      const x = W / 2 - w / 2;

      g.save();
      if (sel) {
        // 선택된 항목만 박자에 반응한다.
        g.translate(W / 2, y);
        g.scale(1 + pulse * 0.02, 1 + pulse * 0.02);
        g.translate(-W / 2, -y);
      }
      shadowed(
        g,
        () => roundRect(g, x, y - h / 2, w, h, 16),
        sel ? C.pink : 'rgba(43, 42, 51, 0.07)',
        sel ? 7 : 3,
      );
      text(g, label, W / 2, y, {
        size: sel ? 26 : 22,
        color: sel ? C.white : C.inkSoft,
        weight: sel ? 800 : 600,
      });
      g.restore();
    });

    const hint =
      this.cursor < MINIGAMES.length
        ? MINIGAMES[this.cursor].hint
        : '내 환경의 입력 지연을 재서 판정을 보정합니다';
    text(g, hint, W / 2, 462, { size: 15, color: C.inkSoft, weight: 500 });
    drawBeatDots(g, beat, 494);
    text(g, '↑ ↓ 로 선택 · 스페이스로 시작', W / 2, H - 20, {
      size: 14,
      color: C.inkSoft,
      weight: 500,
      alpha: 0.75,
    });
  }
}
