import type { App, Scene } from '../core/App';
import { drawBackdrop } from '../minigames/stage';
import { C, H, W, beatPulse, circle, easeOut, roundRect, shadowed, text } from '../core/draw';
import {
  DIFFICULTIES,
  DIFFICULTY_COLOR,
  DIFFICULTY_LABEL,
  DIFFICULTY_NOTE,
  isCleared,
  recordKey,
  suggested,
  type Difficulty,
} from '../core/difficulty';
import { getRecord } from '../core/records';
import { RANK_LABEL } from '../core/types';
import { newSeed } from '../core/rng';
import type { Playable } from './playable';
import { TitleScene } from './TitleScene';

const CARD_W = 224;
const CARD_H = 248;
const CARD_GAP = 26;
const CARD_Y = 196;

/**
 * 난이도 고르기 — 쉬움 / 보통 / 어려움.
 *
 * **셋 다 처음부터 고를 수 있다.** 잠가 두면 이미 잘하는 사람이 쉬운 걸 억지로
 * 한 판 하고 와야 하고, 어려운 게 어떤 건지 구경해 보는 재미도 사라진다.
 * 대신 깬 난이도에 표시를 남겨서 "다음엔 여기"가 눈에 보이게 한다.
 *
 * 목록에 서른 줄을 늘어놓지 않는 이유는, 그렇게 하면 "이 게임을 얼마나 했나"가
 * 한눈에 안 들어오기 때문이다. 카드 셋을 나란히 두면 깬 것과 안 깬 것이 한 화면에
 * 읽힌다.
 */
export class DifficultyScene implements Scene {
  private app!: App;
  private target: Playable;
  private cursor: Difficulty;
  private off: (() => void) | null = null;
  private t = 0;
  private movedAt = -99;

  constructor(target: Playable) {
    this.target = target;
    // 아직 못 깬 가장 쉬운 난이도에 커서를 둔다. 매번 왼쪽 끝부터 훑게 하지 않는다.
    this.cursor = suggested(target.id);
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
      this.app.setScene(new TitleScene());
      return;
    }

    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const i = DIFFICULTIES.indexOf(this.cursor) + (code === 'ArrowRight' ? 1 : -1);
      if (i < 0 || i >= DIFFICULTIES.length) return;
      this.cursor = DIFFICULTIES[i];
      this.movedAt = this.t;
      this.app.audio.blip(this.app.actx.currentTime, 523.25, 0.5, 'square');
      return;
    }

    if (code === 'Space' || code === 'Enter') {
      this.app.audio.good(this.app.actx.currentTime);
      // 씨앗은 여기서 한 번 만들어 설명 화면과 실제 판이 나눠 쓴다.
      this.app.setScene(this.target.begin(this.cursor, newSeed()));
    }
  }

  update(dt: number): void {
    this.t += dt;
  }

  draw(g: CanvasRenderingContext2D): void {
    drawBackdrop(g, this.t * 1.4);

    text(g, this.target.title, W / 2, 82, { size: 40, color: C.ink });
    text(g, this.target.hint, W / 2, 122, { size: 15, color: C.inkSoft, weight: 500 });

    const total = DIFFICULTIES.length * CARD_W + (DIFFICULTIES.length - 1) * CARD_GAP;
    const first = W / 2 - total / 2;

    DIFFICULTIES.forEach((d, i) => {
      this.drawCard(g, first + i * (CARD_W + CARD_GAP), d);
    });

    const blink = 0.55 + Math.sin(this.t * 4) * 0.35;
    text(g, '← → 로 고르고 · 스페이스로 시작 · Esc 로 목록', W / 2, H - 32, {
      size: 15,
      color: C.ink,
      weight: 600,
      alpha: blink,
    });
  }

  private drawCard(g: CanvasRenderingContext2D, x: number, d: Difficulty): void {
    const sel = d === this.cursor;
    const rec = getRecord(recordKey(this.target.id, d));
    const cleared = isCleared(this.target.id, d);
    const accent = DIFFICULTY_COLOR[d];

    const since = this.t - this.movedAt;
    const pop = sel && since < 0.4 ? easeOut(1 - since / 0.4, 3) : 0;
    const scale = sel ? 1.05 + pop * 0.04 : 1;

    g.save();
    g.translate(x + CARD_W / 2, CARD_Y + CARD_H / 2);
    g.scale(scale, scale);
    g.translate(-CARD_W / 2, -CARD_H / 2);

    shadowed(g, () => roundRect(g, 0, 0, CARD_W, CARD_H, 20), sel ? accent : C.white, sel ? 8 : 4);
    g.strokeStyle = sel ? C.ink : 'rgba(43, 42, 51, 0.16)';
    g.lineWidth = sel ? 3.5 : 2;
    roundRect(g, 0, 0, CARD_W, CARD_H, 20);
    g.stroke();

    const ink = sel ? C.white : C.ink;
    const soft = sel ? 'rgba(255,255,255,0.85)' : C.inkSoft;

    // 난이도를 막대 셋으로도 보여준다. 글자를 안 읽어도 순서가 잡힌다.
    const level = DIFFICULTIES.indexOf(d) + 1;
    for (let i = 0; i < 3; i++) {
      const on = i < level;
      g.fillStyle = on ? (sel ? C.white : accent) : sel ? 'rgba(255,255,255,0.3)' : 'rgba(43, 42, 51, 0.14)';
      roundRect(g, CARD_W / 2 - 33 + i * 24, 52 - i * 8, 16, 18 + i * 8, 4);
      g.fill();
    }

    text(g, DIFFICULTY_LABEL[d], CARD_W / 2, 108, { size: 34, color: ink, weight: 900 });

    for (const [i, line] of splitNote(DIFFICULTY_NOTE[d]).entries()) {
      text(g, line, CARD_W / 2, 148 + i * 19, { size: 13, color: soft, weight: 500 });
    }

    // 기록 — 없으면 빈 자리를 남긴다. 비어 있어야 채우고 싶어진다.
    const badgeY = CARD_H - 42;
    if (!rec) {
      text(g, '아직 기록 없음', CARD_W / 2, badgeY, { size: 13, color: soft, weight: 600 });
    } else {
      const mark = rec.allPerfect ? '★ ' : '';
      text(g, `${mark}${RANK_LABEL[rec.rank]} · ${rec.combo}${this.target.unit}`, CARD_W / 2, badgeY, {
        size: 13,
        color: cleared ? (sel ? C.white : C.mint) : soft,
        weight: 800,
      });
    }

    if (cleared) {
      g.fillStyle = sel ? C.white : C.mint;
      circle(g, CARD_W - 26, 26, 6 + beatPulse(this.t * 1.6, 4) * 2);
      g.fill();
    }

    g.restore();
  }
}

/** 카드 폭에 맞춰 한 줄 설명을 두 도막으로. 가운데 공백에서 끊는다. */
function splitNote(note: string): string[] {
  if (note.length <= 14) return [note];
  const mid = Math.floor(note.length / 2);
  for (let d = 0; d < note.length; d++) {
    if (note[mid - d] === ' ') return [note.slice(0, mid - d), note.slice(mid - d + 1)];
    if (note[mid + d] === ' ') return [note.slice(0, mid + d), note.slice(mid + d + 1)];
  }
  return [note];
}
