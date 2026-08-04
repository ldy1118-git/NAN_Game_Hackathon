import type { App, Scene } from '../core/App';
import { C, W, beatPulse, clamp, easeBack, easeOut, text } from '../core/draw';
import { CAST, drawCharacter, type CastId } from '../minigames/cast';
import { decay } from '../minigames/beat';
import { drawStage, GROUND_Y } from '../minigames/stage';
import { TitleScene } from './TitleScene';

const BPM = 112;
/** 예약을 짧게만 — 타이틀로 넘어간 뒤까지 소리가 새지 않도록. */
const LOOKAHEAD = 0.08;

/** 한 박에 한 명씩 나온다. */
const ENTER_EVERY = 1;
/** 여섯 명이 다 나온 뒤 안내가 뜨기까지. */
const PROMPT_BEAT = CAST.length * ENTER_EVERY + 1;

const SLOT_GAP = 152;
const FIRST_X = (W - SLOT_GAP * (CAST.length - 1)) / 2;
const CHAR_H = 140;

/** 등장 순서 — 남녀를 번갈아 세워야 한 줄이 심심하지 않다. */
const ORDER: readonly CastId[] = ['man1', 'girl1', 'man2', 'girl2', 'man3', 'girl3'];

/**
 * 여섯 명을 소개하는 인트로.
 *
 * 타이틀 화면에 끼워넣지 않고 씬을 따로 둔 이유: 타이틀은 이미 세로가 꽉 차 있다
 * (메뉴 182~462, 힌트 470, 박자점 500). 6명을 우겨넣으면 둘 다 좁아진다.
 */
export class CastScene implements Scene {
  private app!: App;
  private nextStep = 0;
  private off: (() => void) | null = null;

  enter(app: App): void {
    this.app = app;
    app.conductor.start(BPM, 0.35);
    this.off = app.input.onUiKey(() => this.skip());
  }

  exit(): void {
    this.off?.();
  }

  private skip(): void {
    this.app.audio.good(this.app.actx.currentTime);
    this.app.setScene(new TitleScene());
  }

  update(): void {
    const c = this.app.conductor;
    const horizon = c.scheduleBeat + LOOKAHEAD / c.secPerBeat;
    while (this.nextStep * 0.5 <= horizon) {
      const t = c.beatToCtxTime(this.nextStep * 0.5);
      const inBar = this.nextStep % 8;
      if (inBar === 0 || inBar === 6) this.app.audio.kick(t, 0.55);
      if (inBar === 4) this.app.audio.snare(t, 0.4);
      this.app.audio.hat(t, inBar % 2 === 1 ? 0.35 : 0.18);
      // 한 명씩 나올 때마다 인사하듯 한 음씩 올라간다.
      const beat = this.nextStep * 0.5;
      if (Number.isInteger(beat) && beat >= 0 && beat < CAST.length * ENTER_EVERY) {
        const i = beat / ENTER_EVERY;
        if (Number.isInteger(i)) {
          this.app.audio.blip(t, 392 * Math.pow(2, i / 12), 0.55, 'triangle');
        }
      }
      this.nextStep++;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    const beat = this.app.conductor.beat;
    drawStage(g, beat);

    const pulse = beatPulse(beat, 5);

    g.save();
    g.translate(W / 2, 92);
    g.scale(1 + pulse * 0.03, 1 + pulse * 0.03);
    text(g, 'NAN GAME', 0, 0, { size: 52, color: C.ink });
    g.restore();
    text(g, '여섯 명을 소개합니다', W / 2, 134, {
      size: 17,
      color: C.inkSoft,
      weight: 500,
    });

    ORDER.forEach((id, i) => {
      const at = i * ENTER_EVERY;
      const since = beat - at;
      if (since < 0) return; // 아직 등장 전

      // 등장 — 튀어오르며 착지한다.
      const inT = clamp(since / 0.55, 0, 1);
      const pop = easeBack(inT);
      // 등장 직후엔 크게, 그 뒤엔 박마다 가볍게 튄다.
      const hop = since < 0.55
        ? (1 - easeOut(inT, 2)) * 54
        : beatPulse(beat + i * 0.5, 6) * 7;

      // 얼굴을 보여주는 연출 — 나오면서 한 번 크게 입을 벌린다.
      const greet = decay(beat, at, 0.7, 2);
      // man2 는 원래 혀를 내밀고 있는 캐릭터라 인사도 메롱으로.
      const isTongue = id === 'man2';

      drawCharacter(g, {
        id,
        x: FIRST_X + i * SLOT_GAP,
        y: GROUND_Y,
        h: CHAR_H * pop,
        hop,
        squash: since < 0.55 ? 0 : decay(beat, Math.floor(beat), 0.5, 3) * 0.16,
        tilt: Math.sin((beat + i * 0.7) * Math.PI) * 0.03,
        sing: isTongue ? greet * 0.5 : greet,
        tongue: isTongue ? greet : 0,
      });
    });

    if (beat >= PROMPT_BEAT) {
      const blink = 0.5 + Math.sin(beat * 2.2) * 0.4;
      // 바닥선(396)과 박자 점(490) 사이. 아래로 더 내리면 점과 겹친다.
      text(g, '아무 키나 누르면 시작합니다', W / 2, 444, {
        size: 17,
        color: C.ink,
        weight: 600,
        alpha: blink,
      });
    }
  }
}
