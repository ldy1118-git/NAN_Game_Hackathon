import type { App, Scene } from '../core/App';
import { drawBackdrop } from '../minigames/stage';
import { C, H, W, roundRect, shadowed, text } from '../core/draw';
import { DIFFICULTY_LABEL, type Difficulty } from '../core/difficulty';
import type { MiniGameEntry } from '../minigames';
import type { MiniGame } from '../minigames/MiniGame';
import type { FreeGame } from '../minigames/FreeGame';
import { PREVIEW_H, PREVIEW_W, keyCaps, keyCapsWidth } from '../minigames/howto';
import { FreePlayScene } from './FreePlayScene';
import { PlayScene } from './PlayScene';
import { DifficultyScene } from './DifficultyScene';
import { fromEntry } from './playable';

const PREVIEW_X = (W - PREVIEW_W) / 2;
const PREVIEW_Y = 96;

/**
 * 시작하기 전 설명.
 *
 * 이게 없을 때는 첫 판이 늘 버린 판이었다 — 무슨 키를 눌러야 하는지 화면에서
 * 알아내는 동안 노트가 지나갔다. 힌트 한 줄로는 안 됐다. 조작이 여섯 키인
 * 게임과 한 키인 게임을 같은 문장 길이로 설명할 수 없기 때문이다.
 *
 * 그래서 셋을 보여준다 — **무엇이 움직이는지(그림), 무엇을 누르는지(키 배지),
 * 무엇이 점수가 되는지(한 줄).** 그림은 게임이 직접 그린다. 자기 화면을 이미
 * 그릴 줄 아는 쪽이 축약본도 제일 잘 그린다.
 *
 * 여기서 만든 게임 인스턴스를 그대로 실제 판에 넘기지는 않는다. 대신 씨앗을
 * 넘겨 같은 씨앗으로 다시 만든다 — 미리보기를 돌려보느라 상태가 더럽혀진
 * 인스턴스로 판을 시작하지 않기 위해서다.
 */
export class HowToScene implements Scene {
  private app!: App;
  private entry: MiniGameEntry;
  private difficulty: Difficulty;
  private seed: number;
  private game: MiniGame | FreeGame;
  private off: (() => void) | null = null;
  private t = 0;

  constructor(entry: MiniGameEntry, difficulty: Difficulty, seed: number) {
    this.entry = entry;
    this.difficulty = difficulty;
    this.seed = seed;
    this.game = entry.create(difficulty, seed);
  }

  enter(app: App): void {
    this.app = app;
    this.off = app.input.onUiKey((code) => this.onKey(code));
  }

  exit(): void {
    this.off?.();
  }

  private onKey(code: string): void {
    if (code === 'Escape') {
      this.app.setScene(new DifficultyScene(fromEntry(this.entry)));
      return;
    }
    if (code === 'Space' || code === 'Enter') {
      this.app.audio.good(this.app.actx.currentTime);
      const entry = this.entry;
      this.app.setScene(
        entry.kind === 'free'
          ? new FreePlayScene(entry, this.difficulty, this.seed)
          : new PlayScene(entry, this.difficulty, this.seed),
      );
    }
  }

  update(dt: number): void {
    this.t += dt;
  }

  draw(g: CanvasRenderingContext2D): void {
    drawBackdrop(g, this.t * 1.4);

    text(g, this.entry.title, W / 2, 40, { size: 26, color: C.ink });
    text(g, DIFFICULTY_LABEL[this.difficulty], W / 2, 68, {
      size: 15,
      color: C.pink,
      weight: 800,
    });

    this.drawPreview(g);
    this.drawControls(g);

    text(g, this.game.scoring, W / 2, 470, { size: 17, color: C.ink, weight: 700 });

    const blink = 0.55 + Math.sin(this.t * 4) * 0.35;
    text(g, '스페이스로 시작 · Esc 로 뒤로', W / 2, H - 30, {
      size: 15,
      color: C.ink,
      weight: 600,
      alpha: blink,
    });
  }

  /** 게임이 그리는 되풀이 그림. 상자 밖으로 새지 않도록 잘라준다. */
  private drawPreview(g: CanvasRenderingContext2D): void {
    shadowed(
      g,
      () => roundRect(g, PREVIEW_X, PREVIEW_Y, PREVIEW_W, PREVIEW_H, 18),
      C.white,
      5,
    );

    g.save();
    roundRect(g, PREVIEW_X, PREVIEW_Y, PREVIEW_W, PREVIEW_H, 18);
    g.clip();
    g.translate(PREVIEW_X, PREVIEW_Y);
    this.game.preview(g, this.t);
    g.restore();

    g.strokeStyle = 'rgba(43, 42, 51, 0.14)';
    g.lineWidth = 2;
    roundRect(g, PREVIEW_X, PREVIEW_Y, PREVIEW_W, PREVIEW_H, 18);
    g.stroke();
  }

  /** 조작 안내 — 키 배지와 설명을 한 줄씩. 눌리는 것처럼 번갈아 빛난다. */
  private drawControls(g: CanvasRenderingContext2D): void {
    const rows = this.game.controls;
    const top = PREVIEW_Y + PREVIEW_H + 40;
    const rowH = 46;

    // 배지 폭이 제각각이라, 가장 넓은 줄을 기준으로 열을 맞춘다.
    const widest = Math.max(...rows.map((r) => keyCapsWidth(r.keys)));
    const labelGap = 22;
    const blockW = widest + labelGap + 190;
    const left = W / 2 - blockW / 2;

    rows.forEach((row, i) => {
      const y = top + i * rowH;
      // 한 줄씩 차례로 반짝인다 — "이걸 눌러 보세요"가 눈에 걸리도록.
      const phase = (this.t * 0.8) % rows.length;
      const glow = Math.max(0, 1 - Math.abs(phase - i) * 2.4);

      keyCaps(g, left + widest - keyCapsWidth(row.keys), y, row.keys, glow);
      text(g, row.label, left + widest + labelGap, y, {
        size: 17,
        color: C.ink,
        align: 'left',
        weight: 700,
        alpha: 0.6 + glow * 0.4,
      });
    });
  }
}
