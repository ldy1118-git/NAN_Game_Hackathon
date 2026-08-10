import type { App, Scene } from '../core/App';
import { drawBackdrop } from '../minigames/stage';
import { C, H, W, clamp, easeBack, easeOut, roundRect, shadowed, text } from '../core/draw';
import { DIFFICULTY_COLOR, DIFFICULTY_LABEL, type Difficulty } from '../core/difficulty';
import { MINIGAMES, type MiniGameEntry } from '../minigames';
import { PREVIEW_H, PREVIEW_W, keyCaps, keyCapsWidth } from '../minigames/howto';
import { DifficultyScene } from './DifficultyScene';
import { FreePlayScene } from './FreePlayScene';
import { PlayScene } from './PlayScene';
import { ResultScene } from './ResultScene';
import { MEDLEY } from './playable';
import { medleyRoster, type RoundHost, type RoundResult } from './round';

/** 판과 판 사이에 다음 게임을 소개하는 시간(초). */
const CARD_SEC = 3.2;

type Phase = 'card' | 'playing' | 'over';

/**
 * 종합게임 — 미니게임 여럿을 쉬지 않고 이어서 한다.
 *
 * 한 게임만 반복하면 그 게임의 손버릇만 는다. 여기서는 조작이 판마다 통째로
 * 바뀌므로(자리 찾기 → 연타 → 길게 누르기 → 판단) **머리가 전환을 따라가는지**를
 * 묻게 된다. 게임 열 개를 각각 잘하는 것과 열 개를 이어서 하는 건 다른 일이다.
 *
 * 판 사이에 3초짜리 소개 카드를 끼운다. 곧바로 이어 붙이면 무슨 게임이 시작됐는지
 * 알아채는 데 첫 두어 개를 버리게 된다 — 그건 실력이 아니라 사고다.
 *
 * 구현은 씬을 감싸는 씬이다. 실제 판은 `PlayScene` / `FreePlayScene` 을 그대로
 * 쓰고, 끝났을 때 결과 화면으로 가는 대신 여기로 돌아오게 `RoundHost` 를 끼운다.
 * 판을 돌리는 코드를 두 벌 만들지 않기 위해서다.
 */
export class MedleyScene implements Scene {
  private app!: App;
  private difficulty: Difficulty;
  private seed: number;
  private entries: typeof MINIGAMES;
  private results: RoundResult[] = [];
  private idx = 0;

  private phase: Phase = 'card';
  private cardLeft = CARD_SEC;
  private child: Scene | null = null;
  private t = 0;
  private off: (() => void) | null = null;
  /**
   * 소개 카드가 그릴 인스턴스.
   *
   * 카드를 그릴 때마다 새로 만들면 리듬 게임은 프레임마다 채보를 통째로 다시
   * 짠다. 카드가 바뀔 때 한 번만 만들어 들고 있는다. 실제 판은 `startRound` 가
   * 따로 만든다 — 미리보기를 돌리느라 더럽혀진 인스턴스로 시작하지 않도록.
   */
  private cardGame: ReturnType<MiniGameEntry['create']>;

  constructor(difficulty: Difficulty, seed: number) {
    this.difficulty = difficulty;
    this.seed = seed;
    this.entries = medleyRoster(MINIGAMES, difficulty, seed);
    this.cardGame = this.entries[0].create(difficulty, 1);
  }

  enter(app: App): void {
    this.app = app;
    // 소개 카드에서 스페이스를 누르면 기다리지 않고 바로 시작한다.
    this.off = app.input.onUiKey((code) => {
      if (this.phase !== 'card') return;
      if (code === 'Escape') this.quit();
      else if (code === 'Space' || code === 'Enter') this.cardLeft = 0;
    });
  }

  exit(): void {
    this.off?.();
    this.endChild();
  }

  // --- RoundHost — 실제 판이 여기로 돌아온다 -------------------------------

  private get host(): RoundHost {
    return {
      label: `도전 ${this.idx + 1} / ${this.entries.length}`,
      done: (r) => this.finishRound(r),
      quit: () => this.quit(),
    };
  }

  private finishRound(r: RoundResult): void {
    this.results.push(r);
    this.endChild();
    this.idx++;

    if (this.idx >= this.entries.length) {
      this.phase = 'over';
      this.app.setScene(ResultScene.fromMedley(this.difficulty, this.results));
      return;
    }

    this.phase = 'card';
    this.cardLeft = CARD_SEC;
    this.cardGame = this.entries[this.idx].create(this.difficulty, 1);
  }

  private quit(): void {
    this.endChild();
    this.app.setScene(new DifficultyScene(MEDLEY));
  }

  // --- 자식 씬 관리 --------------------------------------------------------

  /**
   * 자식 씬을 시작한다.
   *
   * `App.setScene` 을 못 쓴다 — 그러면 종합게임 자신이 화면에서 밀려난다.
   * 대신 setScene 이 해주던 뒷정리(입력 큐 비우기)를 여기서 똑같이 해준다.
   * 이걸 빠뜨리면 소개 카드에서 누른 스페이스가 첫 노트 판정으로 샌다.
   */
  private startRound(): void {
    const entry = this.entries[this.idx];
    // 판마다 다른 씨앗 — 같은 게임이 두 번 나와도 채보가 다르다.
    const seed = (this.seed + this.idx * 7919) & 0x7fffffff;
    this.child =
      entry.kind === 'free'
        ? new FreePlayScene(entry, this.difficulty, seed, this.host)
        : new PlayScene(entry, this.difficulty, seed, this.host);
    this.app.input.clear();
    this.child.enter?.(this.app);
    this.phase = 'playing';
  }

  private endChild(): void {
    this.child?.exit?.();
    this.child = null;
  }

  // --- 루프 ---------------------------------------------------------------

  update(dt: number): void {
    this.t += dt;
    if (this.phase === 'over') return;

    if (this.phase === 'card') {
      this.cardLeft -= dt;
      // 카드를 보는 동안 눌린 키가 판이 시작하자마자 판정으로 새면 안 된다.
      this.app.input.clear();
      if (this.cardLeft <= 0) this.startRound();
      return;
    }

    this.child?.update(dt);
  }

  /** 멈춤은 진행 중인 판이 알아서 수습한다. 카드 화면은 시간이 흘러도 문제없다. */
  onStall(gapSec: number): void {
    if (this.phase === 'playing') this.child?.onStall?.(gapSec);
  }

  draw(g: CanvasRenderingContext2D): void {
    if (this.phase === 'card') {
      this.drawCard(g);
      return;
    }
    this.child?.draw(g);
  }

  /**
   * 다음 게임 소개 카드.
   *
   * 이름만 띄우고 넘기면 조작을 기억해 내는 데 시간이 걸린다. 설명 화면과 같은
   * 키 배지와 미리보기 그림을 작게 다시 보여준다 — 처음 보는 게 아니라 "아 그거"
   * 하고 떠올리게 하는 게 목적이라 3초면 충분하다.
   */
  private drawCard(g: CanvasRenderingContext2D): void {
    const entry = this.entries[this.idx];
    const accent = DIFFICULTY_COLOR[this.difficulty];
    const age = CARD_SEC - this.cardLeft;

    drawBackdrop(g, this.t * 1.4);

    // 진행 막대 — 몇 판째인지가 화면 맨 위에 늘 있다.
    g.fillStyle = 'rgba(43, 42, 51, 0.1)';
    g.fillRect(0, 0, W, 6);
    g.fillStyle = accent;
    g.fillRect(0, 0, (W * this.idx) / this.entries.length, 6);

    text(g, `${MEDLEY.title} · ${DIFFICULTY_LABEL[this.difficulty]}`, W / 2, 44, {
      size: 15,
      color: C.inkSoft,
      weight: 700,
    });
    text(g, `${this.idx + 1} / ${this.entries.length}`, W / 2, 74, {
      size: 22,
      color: accent,
      weight: 900,
    });

    // 이름 — 튀어오르며 등장.
    const pop = easeBack(clamp(age / 0.45, 0, 1));
    g.save();
    g.translate(W / 2, 132);
    g.scale(pop, pop);
    text(g, entry.title, 0, 0, { size: 46, color: C.ink });
    g.restore();

    // 미리보기 — 설명 화면과 같은 그림을 작게.
    const scale = 0.62;
    const bw = PREVIEW_W * scale;
    const bh = PREVIEW_H * scale;
    const bx = W / 2 - bw / 2;
    const by = 172;

    g.save();
    g.globalAlpha = easeOut(clamp((age - 0.2) / 0.4, 0, 1), 2);
    shadowed(g, () => roundRect(g, bx, by, bw, bh, 14), C.white, 4);
    g.save();
    roundRect(g, bx, by, bw, bh, 14);
    g.clip();
    g.translate(bx, by);
    g.scale(scale, scale);
    this.cardGame.preview(g, this.t);
    g.restore();
    g.strokeStyle = 'rgba(43, 42, 51, 0.14)';
    g.lineWidth = 2;
    roundRect(g, bx, by, bw, bh, 14);
    g.stroke();
    g.restore();

    // 조작 — 한 줄로 좁혀 붙인다.
    const rows = this.cardGame.controls;
    const y0 = by + bh + 36;
    rows.forEach((row, i) => {
      const y = y0 + i * 40;
      const w = keyCapsWidth(row.keys);
      keyCaps(g, W / 2 - w - 12, y, row.keys, 0.6);
      text(g, row.label, W / 2 + 12, y, {
        size: 16,
        color: C.ink,
        align: 'left',
        weight: 700,
      });
    });

    const countdown = Math.max(1, Math.ceil(this.cardLeft));
    text(g, `${countdown}`, W - 44, 44, { size: 30, color: accent, align: 'right' });
    text(g, '스페이스로 바로 시작 · Esc 로 그만두기', W / 2, H - 26, {
      size: 14,
      color: C.inkSoft,
      weight: 600,
      alpha: 0.5 + Math.sin(this.t * 4) * 0.3,
    });
  }
}
