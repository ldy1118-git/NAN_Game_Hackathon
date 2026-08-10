import type { App, Scene } from '../core/App';
import { C, H, W, clamp, easeOut, text } from '../core/draw';
import { Fx } from '../core/fx';
import { DIFFICULTY_LABEL, type Difficulty } from '../core/difficulty';
import type { FreeGame, FreeInput } from '../minigames/FreeGame';
import type { MiniGameEntry } from '../minigames';
import { DifficultyScene } from './DifficultyScene';
import { fromEntry } from './playable';
import { ResultScene } from './ResultScene';
import type { RoundHost } from './round';

/** 재개할 때 세어주는 시간(초). 리듬 쪽과 달리 박자가 없으므로 그냥 초로 센다. */
const RESUME_SEC = 2.4;
const DEFAULT_KEYS = ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

type Phase = 'playing' | 'paused' | 'resuming';

/**
 * 박자에 매이지 않는 미니게임을 돌리는 씬.
 *
 * PlayScene 과 나눈 이유는 시간의 성격이 다르기 때문이다. 리듬 쪽은 오디오 클럭이
 * 곡을 끌고 가고 화면은 그 함수일 뿐이지만, 여기서는 게임이 자기 상태를 dt 로
 * 굴린다. 같은 씬에 억지로 합치면 양쪽 다 어중간해진다.
 *
 * 대신 멈춤 처리는 똑같이 지킨다 — 탭을 옮겼다 오면 dt 가 한꺼번에 몰려 들어와
 * 캐릭터가 순간이동하고, 제한 시간이 통째로 날아간다.
 */
export class FreePlayScene implements Scene {
  private app!: App;
  private entry: MiniGameEntry;
  private difficulty: Difficulty;
  private seed: number;
  /** 종합게임이 감싸고 있으면 결과·나가기를 그쪽에 넘긴다. */
  private host: RoundHost | null;
  private game!: FreeGame;
  private off: (() => void) | null = null;
  private done = false;
  private phase: Phase = 'playing';
  private resumeLeft = 0;
  /** 시작 후 흐른 시간(초). 멈춰 있는 동안은 늘지 않는다. */
  private elapsed = 0;
  /** 이번 프레임에 새로 눌린 키. update 시작에 채우고 끝나면 비운다. */
  private freshKeys = new Set<string>();
  /**
   * 장식 효과.
   *
   * 자유형은 판정이 없어서 리듬 쪽처럼 등급을 볼 수 없다. 대신 게임이
   * `hit()` 을 불러 "지금 뭔가 세게 일어났다"를 알려주면 그때 터뜨린다.
   */
  private fx = new Fx();

  constructor(
    entry: MiniGameEntry,
    difficulty: Difficulty,
    seed: number,
    host: RoundHost | null = null,
  ) {
    this.entry = entry;
    this.difficulty = difficulty;
    this.seed = seed;
    this.host = host;
  }

  enter(app: App): void {
    this.app = app;
    const entry = this.entry;
    if (entry.kind !== 'free') throw new Error('FreePlayScene 은 자유형 게임 전용입니다');
    this.game = entry.create(this.difficulty, this.seed);
    this.game.start(app.audio);
    this.off = app.input.onUiKey((code) => this.onKey(code));
  }

  exit(): void {
    this.off?.();
  }

  private onKey(code: string): void {
    if (this.done) return;
    if (this.phase === 'playing') {
      if (code === 'Escape') this.pause();
      return;
    }
    if (code === 'Escape') {
      if (this.host) this.host.quit();
      else this.app.setScene(new DifficultyScene(fromEntry(this.entry)));
    }
    else if (code === 'Space' || code === 'Enter') {
      this.resumeLeft = RESUME_SEC;
      this.phase = 'resuming';
    }
  }

  /** 탭 전환·긴 멈춤. 자유형도 똑같이 멈춰야 제한 시간이 안 날아간다. */
  onStall(): void {
    if (this.done || this.phase === 'paused') return;
    this.pause();
  }

  private pause(): void {
    this.app.input.clear();
    this.freshKeys.clear();
    this.phase = 'paused';
  }

  update(dt: number): void {
    if (this.done) return;

    if (this.phase === 'paused') {
      this.app.input.clear();
      return;
    }

    if (this.phase === 'resuming') {
      this.resumeLeft -= dt;
      if (this.resumeLeft > 0) {
        this.app.input.clear();
        return;
      }
      this.app.input.clear();
      this.phase = 'playing';
    }

    // 이번 프레임에 새로 눌린 키를 모은다. 자유형 게임은 정확한 시각이 필요 없고
    // "이 프레임에 눌렸나"만 알면 되므로 down 만 걸러 담는다.
    this.freshKeys.clear();
    for (const p of this.app.input.drain()) {
      if (p.kind === 'down') this.freshKeys.add(p.code);
    }

    this.elapsed += dt;
    this.game.update(dt, this.elapsed, this.input, this.app.audio);
    this.fx.update(dt);

    const timeUp = this.game.duration > 0 && this.elapsed >= this.game.duration;
    if (timeUp || this.game.done) {
      this.done = true;
      const r = this.game.result();
      if (this.host) {
        this.host.done({ entry: this.entry, rank: r.rank, headline: r.headline, value: r.score });
      } else {
        this.app.setScene(ResultScene.fromFree(this.entry, this.difficulty, r));
      }
    }
  }

  private input: FreeInput = {
    pressed: (code) => this.freshKeys.has(code),
    down: (code) => this.app.input.isDown(code),
    burst: (x, y, colors, o) => this.fx.burst(x, y, colors, o),
    shake: (amount) => this.fx.shake(amount),
  };

  draw(g: CanvasRenderingContext2D): void {
    g.save();
    g.translate(this.fx.shakeX, this.fx.shakeY);
    this.game.draw(g, this.elapsed);
    this.fx.draw(g);
    g.restore();
    this.drawHud(g);
    if (this.phase !== 'playing') this.drawOverlay(g);
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    // 남은 시간 막대 — 리듬 쪽 진행 막대와 같은 자리, 같은 모양.
    if (this.game.duration > 0) {
      const left = clamp(1 - this.elapsed / this.game.duration, 0, 1);
      g.fillStyle = 'rgba(43, 42, 51, 0.1)';
      g.fillRect(0, 0, W, 6);
      // 5초 남으면 빨개진다.
      const remain = this.game.duration - this.elapsed;
      g.fillStyle = remain <= 5 ? C.pink : C.blue;
      g.fillRect(0, 0, W * left, 6);

      if (remain <= 5) {
        const n = Math.max(0, Math.ceil(remain));
        const frac = remain - Math.floor(remain);
        text(g, `${n}`, W - 34, 44, {
          size: 30 + easeOut(1 - frac, 3) * 10,
          color: C.pink,
          align: 'right',
        });
      }
    }

    text(g, `${this.entry.title} · ${this.host?.label ?? DIFFICULTY_LABEL[this.difficulty]}`, 22, 30, {
      size: 17,
      color: C.inkSoft,
      align: 'left',
      weight: 700,
      alpha: 0.7,
    });
  }

  private drawOverlay(g: CanvasRenderingContext2D): void {
    g.save();
    g.fillStyle = 'rgba(250, 245, 235, 0.86)';
    g.fillRect(0, 0, W, H);

    if (this.phase === 'resuming') {
      const n = Math.max(1, Math.ceil(this.resumeLeft));
      const pop = easeOut(1 - (this.resumeLeft - Math.floor(this.resumeLeft)), 3);
      text(g, `${n}`, W / 2, H / 2 - 10, { size: 92 + pop * 26, color: C.pink });
      text(g, '준비하세요', W / 2, H / 2 + 66, { size: 18, color: C.inkSoft, weight: 600 });
      g.restore();
      return;
    }

    text(g, '일시정지', W / 2, H / 2 - 40, { size: 46, color: C.ink });
    text(g, `${this.entry.title} · ${DIFFICULTY_LABEL[this.difficulty]}`,
      W / 2, H / 2 - 6, { size: 15, color: C.inkSoft, weight: 600, alpha: 0.8 });
    text(g, this.host ? '스페이스로 이어서 · Esc 로 도전 그만두기'
                      : '스페이스로 이어서 · Esc 로 나가기', W / 2, H / 2 + 24, {
      size: 18,
      color: C.inkSoft,
      weight: 600,
    });
    g.restore();
  }
}

/** 자유형 게임이 기본으로 막아둘 키. Input 의 preventDefault 목록과 맞춘다. */
export const FREE_DEFAULT_KEYS = DEFAULT_KEYS;
