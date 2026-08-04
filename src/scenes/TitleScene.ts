import type { App, Scene } from '../core/App';
import { C, H, W, beatPulse, circle, clamp, easeOut, roundRect, shadowed, text } from '../core/draw';
import { getRecord } from '../core/records';
import { MINIGAMES } from '../minigames';
import { drawBeatDots } from '../minigames/stage';
import { CalibrationScene } from './CalibrationScene';
import { PlayScene } from './PlayScene';

const MENU_BPM = 112;
/** 타이틀 화면은 예약을 아주 짧게만 걸어둔다 — 게임 시작 직후까지 소리가 새지 않도록. */
const TITLE_LOOKAHEAD = 0.08;

/** 한 번에 보여줄 메뉴 줄 수. 미니게임이 더 늘어나면 나머지는 스크롤된다. */
const VISIBLE_ROWS = 5;
const ROW_H = 50;
const MENU_TOP = 176;
/** 스크롤 화살표를 놓을 자리. 목록 위아래로 이만큼 띄운다. */
const ARROW_GAP = 10;

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

  /**
   * 멈췄다 돌아왔을 때. 메뉴는 판정이 없으니 그냥 박자를 지금부터 다시 센다.
   * 그대로 두면 스케줄러가 자리를 비운 시간만큼의 스텝을 한 프레임에 훑는다.
   */
  onStall(): void {
    this.app.conductor.start(MENU_BPM, 0.25);
    this.nextStep = 0;
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
    text(g, '박자에 맞춰 누르는 리듬 미니게임', W / 2, 146, {
      size: 17,
      color: C.inkSoft,
      weight: 500,
    });

    // 메뉴 — 미니게임이 늘어나도 화면을 넘지 않도록 창을 두고 스크롤한다.
    const items = this.items;
    const n = items.length;
    const maxStart = Math.max(0, n - VISIBLE_ROWS);
    // 커서를 창 가운데 두되, 목록의 처음·끝에서는 더 밀지 않는다.
    const start = clamp(this.cursor - Math.floor(VISIBLE_ROWS / 2), 0, maxStart);
    const shown = Math.min(VISIBLE_ROWS, n);

    for (let row = 0; row < shown; row++) {
      const i = start + row;
      const sel = i === this.cursor;
      const y = MENU_TOP + row * ROW_H + ROW_H / 2;
      const since = beat - this.movedAt;
      const pop = sel && since < 0.5 ? easeOut(1 - since / 0.5, 3) : 0;
      const w = 400 + (sel ? 26 : 0) + pop * 14;
      const h = ROW_H - 10;
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
        () => roundRect(g, x, y - h / 2, w, h, 14),
        sel ? C.pink : 'rgba(43, 42, 51, 0.07)',
        sel ? 6 : 3,
      );
      text(g, items[i], W / 2, y, {
        size: sel ? 24 : 20,
        color: sel ? C.white : C.inkSoft,
        weight: sel ? 800 : 600,
      });

      // 아직 측정 전이면 타이밍 맞추기 줄에 점을 찍어둔다. 안내 문구와 짝을 이뤄
      // "어디를 눌러야 하는지"까지 알려준다.
      if (i === MINIGAMES.length && !this.app.hasCalibrated) {
        g.fillStyle = sel ? C.white : C.pink;
        circle(g, x + w - 22, y, 4 + beatPulse(beat, 4) * 2.5);
        g.fill();
      }

      // 미니게임 줄에는 지금까지의 최고 기록을 붙인다.
      if (i < MINIGAMES.length) {
        drawRecordBadge(g, MINIGAMES[i].id, x + w - 16, y, sel);
      }
      g.restore();
    }

    // 창 위아래로 더 있으면 화살표로 알린다.
    if (start > 0) drawMoreArrow(g, MENU_TOP - ARROW_GAP, -1);
    if (start + shown < n) drawMoreArrow(g, MENU_TOP + shown * ROW_H + ARROW_GAP, 1);

    // 한 번도 측정한 적이 없으면 힌트 자리를 안내로 바꾼다. 판정 등급이 통째로
    // 갈리는 값인데, 메뉴 맨 아래 항목 하나로는 아무도 누르지 않는다.
    if (!this.app.hasCalibrated) {
      this.drawCalibrationNudge(g, beat);
    } else {
      const hint =
        this.cursor < MINIGAMES.length
          ? MINIGAMES[this.cursor].hint
          : '내 환경의 입력 지연을 재서 판정을 보정합니다';
      text(g, hint, W / 2, 466, { size: 15, color: C.inkSoft, weight: 500 });
    }
    drawBeatDots(g, beat, 500);
    text(g, '↑ ↓ 로 선택 · 스페이스로 시작 · M 음소거 · − + 음량', W / 2, H - 20, {
      size: 14,
      color: C.inkSoft,
      weight: 500,
      alpha: 0.75,
    });
  }

  /**
   * 첫 실행 안내. 캘리브레이션을 한 번도 안 한 사람에게만 보인다.
   *
   * 입력 지연은 환경마다 20~80ms 씩 다르고 이건 판정 등급이 통째로 갈리는 크기다.
   * 그런데 메뉴 맨 아래 항목 하나로 두면 신규 유저는 그냥 지나친다.
   * 힌트 줄을 통째로 빌려 쓰고, 정박에 맞춰 깜빡여 눈에 걸리게 한다.
   */
  private drawCalibrationNudge(g: CanvasRenderingContext2D, beat: number): void {
    const pulse = beatPulse(beat, 4);
    const y = 466;

    g.save();
    g.globalAlpha = 0.5 + pulse * 0.5;
    const label = '처음이신가요?';
    text(g, label, W / 2 - 118, y, { size: 15, color: C.pink, weight: 800 });
    g.restore();

    text(g, '맨 아래 타이밍 맞추기를 먼저 (30초)', W / 2 + 42, y, {
      size: 15,
      color: C.inkSoft,
      weight: 600,
    });
  }
}

/**
 * 메뉴 줄 오른쪽 끝의 기록 표시. 위로 갈수록 좋은 사다리다.
 *
 *   (없음)  아직 안 해봄
 *   숫자    해봤음 — 최고 콤보
 *   완벽    superb 등급을 낸 적 있음
 *   ★       모든 노트를 완벽으로 낸 적 있음
 *
 * 등급 이름(RANK_LABEL)을 그대로 쓰지 않는다. "처음부터"는 결과 화면에서는
 * 권유지만 메뉴에 붙으면 기록이 아니라 지시문으로 읽힌다.
 */
function drawRecordBadge(
  g: CanvasRenderingContext2D,
  id: string,
  right: number,
  y: number,
  sel: boolean,
): void {
  const r = getRecord(id);
  if (!r) return;

  if (r.allPerfect) {
    // 올 퍼펙트는 별 하나로. 글자보다 눈에 먼저 걸린다.
    text(g, '★', right - 8, y, { size: sel ? 20 : 17, color: sel ? C.white : C.yellow });
    return;
  }

  if (r.rank === 'superb') {
    text(g, '완벽', right, y, {
      size: 13,
      color: sel ? C.white : C.mint,
      align: 'right',
      weight: 800,
    });
    return;
  }

  // 아직 등급이 낮으면 최고 콤보를 보여준다. 얼마나 더 가야 하는지가 숫자로 보인다.
  text(g, `${r.combo}`, right, y, {
    size: 13,
    color: sel ? C.white : C.inkSoft,
    align: 'right',
    weight: 700,
    alpha: sel ? 0.8 : 0.5,
  });
}

/** 목록이 더 있다는 표시. dir = -1 위, 1 아래. */
function drawMoreArrow(g: CanvasRenderingContext2D, y: number, dir: number): void {
  g.save();
  g.globalAlpha = 0.45;
  g.fillStyle = C.ink;
  g.beginPath();
  g.moveTo(W / 2, y + dir * 6);
  g.lineTo(W / 2 - 9, y - dir * 4);
  g.lineTo(W / 2 + 9, y - dir * 4);
  g.closePath();
  g.fill();
  g.restore();
}
