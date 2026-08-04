import type { App, Scene } from '../core/App';
import { C, H, W, circle, text } from '../core/draw';
import { CastScene } from './CastScene';

/**
 * 브라우저는 사용자 제스처 없이 AudioContext 를 재생시키지 않는다.
 * 그 한 번의 클릭을 받아내기 위한 화면.
 */
export class BootScene implements Scene {
  private app!: App;
  private t = 0;
  private starting = false;
  private off: (() => void) | null = null;

  enter(app: App): void {
    this.app = app;
    this.off = app.input.onUiKey(() => void this.begin());
  }

  exit(): void {
    this.off?.();
  }

  private async begin(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    await this.app.actx.resume();
    this.app.setScene(new CastScene());
  }

  update(dt: number): void {
    this.t += dt;
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    const pulse = (Math.sin(this.t * 3.2) + 1) / 2;
    g.globalAlpha = 0.12 + pulse * 0.1;
    g.fillStyle = C.pink;
    circle(g, W / 2, H / 2 - 20, 130 + pulse * 18);
    g.fill();
    g.globalAlpha = 1;

    text(g, 'NAN GAME', W / 2, H / 2 - 34, { size: 66, color: C.ink });
    text(g, '리듬 미니게임', W / 2, H / 2 + 20, { size: 22, color: C.inkSoft, weight: 500 });
    text(g, '아무 키나 누르거나 화면을 클릭하세요', W / 2, H / 2 + 120, {
      size: 20,
      color: C.ink,
      weight: 600,
      alpha: 0.45 + pulse * 0.5,
    });
    text(g, '헤드폰이나 이어폰을 쓰면 박자가 훨씬 정확합니다', W / 2, H - 44, {
      size: 15,
      color: C.inkSoft,
      weight: 500,
      alpha: 0.7,
    });
  }
}
