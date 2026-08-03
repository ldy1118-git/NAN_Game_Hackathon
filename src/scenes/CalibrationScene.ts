import type { App, Scene } from '../core/App';
import { C, H, W, beatPulse, circle, clamp, roundRect, shadowed, text } from '../core/draw';
import { TitleScene } from './TitleScene';

const BPM = 100;
const LOOKAHEAD = 0.15;
/** 앞쪽 몇 개는 박자에 올라타는 중이라 버린다. */
const WARMUP = 3;
const NEEDED = 16;

/**
 * 타이밍 맞추기 — 입력 지연 측정.
 *
 * 키보드·OS·모니터가 먹는 지연은 환경마다 20~80ms 씩 다르고, 이건 판정 등급이
 * 통째로 갈리는 크기다. 일정한 클릭에 맞춰 치게 한 뒤, 오차의 중앙값을 offset 으로
 * 저장한다. 평균이 아니라 중앙값을 쓰는 이유는 실수로 한 박 놓친 이상치가
 * 전체를 끌고 가는 걸 막기 위해서다.
 */
export class CalibrationScene implements Scene {
  private app!: App;
  private nextStep = 0;
  private off: (() => void) | null = null;
  /** 각 탭의 오차(초). 양수면 늦게 친 것. */
  private samples: number[] = [];
  private savedOffset: number | null = null;
  private lastTapBeat = -99;

  enter(app: App): void {
    this.app = app;
    // 측정 중에는 보정을 끄고 날것의 오차를 본다. 취소하면 되돌릴 수 있게 기억해둔다.
    this.savedOffset = app.conductor.inputOffset;
    app.conductor.inputOffset = 0;
    app.conductor.start(BPM, 1.2);
    this.off = app.input.onUiKey((code) => {
      if (code === 'Escape') this.finish(false);
      if (code === 'Enter') this.finish(true);
    });
  }

  exit(): void {
    this.off?.();
  }

  private finish(save: boolean): void {
    if (save && this.usable.length > 0) {
      this.app.saveInputOffset(median(this.usable));
    } else if (!save) {
      // 취소하면 저장돼 있던 값을 되돌린다.
      this.app.saveInputOffset(this.savedOffset ?? this.app.conductor.inputOffset);
    }
    this.app.setScene(new TitleScene());
  }

  private get usable(): number[] {
    return this.samples.slice(WARMUP);
  }

  update(): void {
    const c = this.app.conductor;

    // 정박마다 또렷한 클릭. 마디 첫 박은 음을 높여 위치를 알려준다.
    const horizon = c.scheduleBeat + LOOKAHEAD / c.secPerBeat;
    while (this.nextStep <= horizon) {
      if (this.nextStep >= 0) {
        const t = c.beatToCtxTime(this.nextStep);
        const down = this.nextStep % 4 === 0;
        this.app.audio.blip(t, down ? 1567.98 : 1046.5, down ? 0.9 : 0.55, 'square');
      }
      this.nextStep++;
    }

    for (const p of this.app.input.drain()) {
      // 키를 뗀 것은 탭이 아니다 — hold 노트 때문에 up 도 같은 큐로 들어온다.
      if (p.code !== 'Space' || p.kind !== 'down') continue;
      const raw = c.pressToBeat(p.ctxTime); // inputOffset = 0 이므로 날것
      if (raw < 0.5) continue;
      const err = (raw - Math.round(raw)) * c.secPerBeat;
      // 반 박 이상 어긋난 건 박을 놓친 것으로 보고 버린다.
      if (Math.abs(err) > c.secPerBeat * 0.45) continue;
      this.samples.push(err);
      this.lastTapBeat = c.beat;
      if (this.samples.length >= WARMUP + NEEDED) this.finish(true);
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    const beat = this.app.conductor.beat;
    const pulse = beatPulse(beat, 6);

    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    text(g, '타이밍 맞추기', W / 2, 74, { size: 34, color: C.ink });
    text(g, '클릭 소리에 맞춰 스페이스를 계속 치세요', W / 2, 112, {
      size: 17,
      color: C.inkSoft,
      weight: 500,
    });

    // 박자 원 — 정박에 꽉 차고 곧바로 줄어든다.
    const cx = W / 2;
    const cy = 246;
    g.strokeStyle = 'rgba(43, 42, 51, 0.2)';
    g.lineWidth = 4;
    circle(g, cx, cy, 62);
    g.stroke();
    shadowed(g, () => circle(g, cx, cy, 20 + pulse * 42), C.blue, 5);

    // 방금 친 순간의 반응
    const tapAge = beat - this.lastTapBeat;
    if (tapAge >= 0 && tapAge < 0.6) {
      g.save();
      g.globalAlpha = 1 - tapAge / 0.6;
      g.strokeStyle = C.pink;
      g.lineWidth = 6;
      circle(g, cx, cy, 62 + tapAge * 40);
      g.stroke();
      g.restore();
    }

    // 진행 막대
    const need = WARMUP + NEEDED;
    const got = clamp(this.samples.length / need, 0, 1);
    const bw = 420;
    roundRect(g, cx - bw / 2, 348, bw, 12, 6);
    g.fillStyle = 'rgba(43, 42, 51, 0.12)';
    g.fill();
    roundRect(g, cx - bw / 2, 348, bw * got, 12, 6);
    g.fillStyle = C.pink;
    g.fill();
    text(g, `${Math.min(this.samples.length, need)} / ${need}`, cx, 382, {
      size: 15,
      color: C.inkSoft,
      weight: 600,
    });

    // 지금까지의 측정값
    const u = this.usable;
    if (u.length >= 3) {
      const ms = median(u) * 1000;
      const sign = ms >= 0 ? '늦게' : '빠르게';
      text(g, `평균 ${Math.abs(ms).toFixed(0)}ms ${sign} 치는 중`, cx, 424, {
        size: 21,
        color: C.ink,
        weight: 700,
      });
      // 오차 분포를 점으로 흩뿌려 보여준다.
      const half = 0.12; // ±120ms 범위
      g.save();
      for (const e of u) {
        const x = cx + clamp(e / half, -1, 1) * (bw / 2);
        g.globalAlpha = 0.5;
        g.fillStyle = Math.abs(e) < 0.05 ? C.mint : C.yellow;
        circle(g, x, 452, 5);
        g.fill();
      }
      g.globalAlpha = 0.35;
      g.strokeStyle = C.ink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, 440);
      g.lineTo(cx, 464);
      g.stroke();
      g.restore();
    } else {
      text(g, '몇 번 더 치면 결과가 나옵니다', cx, 424, {
        size: 16,
        color: C.inkSoft,
        weight: 500,
      });
    }

    text(g, 'Enter 로 저장 · Esc 로 취소', cx, H - 24, {
      size: 14,
      color: C.inkSoft,
      weight: 500,
      alpha: 0.8,
    });
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
