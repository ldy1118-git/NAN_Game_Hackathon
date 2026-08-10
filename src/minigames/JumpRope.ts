import type { AudioEngine } from '../core/AudioEngine';
import { C, W, clamp, easeOut, lerp, text } from '../core/draw';
import type { Difficulty } from '../core/difficulty';
import { makeRng } from '../core/rng';
import type { BeatEvent, Verdict } from '../core/types';
import { drawCharacter, idleBlink, type CastId } from './cast';
import { basicGroove, type MiniGame, type RenderInfo } from './MiniGame';
import {
  decay,
  layoutPhrases,
  makeTravelPhrases,
  nextBeat,
  windUp,
  type PhraseSpec,
} from './beat';
import { PREVIEW_H, PREVIEW_W, type Control } from './howto';
import { GROUND_Y, drawStage } from './stage';

/**
 * 줄넘기 — 올라갔다 내려오는 줄을 타이밍 맞춰 넘는다.
 *
 * 줄 잡는 캐릭터 둘이 양쪽에서 줄을 돌리면, 중앙 플레이어가 스페이스로 점프한다.
 * 줄의 호(arc) 중점은 순전히 beat 의 함수라 프레임이 밀려도 소리-그림이 어긋나지 않는다.
 *
 * 놓치면 줄에 걸려 넘어진다. 판정 문구만으로는 실패가 남의 일 같은데,
 * 캐릭터가 실제로 자빠지면 다음 줄을 넘길 때 몸이 먼저 긴장한다.
 */

const LEAD_IN = 4;

const HOLDER_LX = 148;
const HOLDER_RX = 812;
const PLAYER_X = W / 2;
/** 뛰는 사람 하나, 줄 돌리는 사람 둘. */
const PLAYER_ID: CastId = 'man1';
const TURNER_L: CastId = 'girl2';
const TURNER_R: CastId = 'girl3';
const BODY_H = 150;
/** 줄 돌리는 쪽은 조연이라 한 뼘 작게 세운다. */
const TURNER_H = 124;

/** 줄 잡는 손의 높이 기준점. 양 끝 호의 시작점이 여기에 고정된다. */
const HAND_Y = GROUND_Y - 132;
/** 줄 호 중점이 올라가는 한계 (캐릭터 위). */
const ROPE_TOP = HAND_Y - 92;
/** 줄 호 중점이 내려오는 한계 (바닥 약간 아래). 여기가 정확히 hit 박. */
const ROPE_BOT = GROUND_Y + 14;

/** 넘어졌다가 다시 일어나는 데 걸리는 박. */
const FALL_LEN = 1.6;
/** 그중 자빠지는 데 쓰는 박. 나머지는 일어나는 시간. */
const FALL_DOWN = 0.3;

interface Params {
  bpm: number;
  phrase: PhraseSpec;
}

/**
 * 난이도별 조임.
 *
 * 쉬움은 1박짜리 줄이 아예 없다(가중치 0, maxRun 0). 2박 간격만으로
 * "줄이 바닥에 닿는 순간"을 몸에 익히는 게 먼저고, 그게 되면 1박은 따라온다.
 */
const PARAMS: Record<Difficulty, Params> = {
  easy: {
    bpm: 104,
    phrase: { phrases: 5, notes: [4, 4], travels: [[2, 1]], maxRun: 0 },
  },
  normal: {
    bpm: 114,
    phrase: { phrases: 6, notes: [4, 5], travels: [[2, 2.2], [1, 1]], maxRun: 2 },
  },
  hard: {
    bpm: 124,
    phrase: { phrases: 7, notes: [5, 6], travels: [[2, 1], [1, 1.7]], maxRun: 4 },
  },
};

export class JumpRope implements MiniGame {
  readonly id = 'jumprope';
  readonly title = '줄넘기';
  readonly hint = '줄이 발에 닿는 순간 점프! — 스페이스';
  readonly order = 30;
  readonly bpm: number;
  readonly endBeat: number;
  readonly controls: readonly Control[] = [
    { keys: ['Space'], label: '줄이 바닥에 닿는 순간 점프' },
  ];
  readonly scoring = '정확할수록 완벽 · 놓치면 줄에 걸려 넘어집니다';

  private events: BeatEvent[];

  constructor(difficulty: Difficulty, seed: number) {
    const p = PARAMS[difficulty];
    this.bpm = p.bpm;

    // cue = 줄이 내려오기 시작하는 박, hit = 줄이 바닥에 닿는 박.
    const phrases = makeTravelPhrases(makeRng(seed), p.phrase);
    const laid = layoutPhrases(phrases, LEAD_IN);
    this.events = laid.events;
    this.endBeat = laid.endBeat + 2;
  }

  build(): BeatEvent[] {
    return this.events;
  }

  groove(step: number, t: number, a: AudioEngine): void {
    basicGroove(step, t, a);
  }

  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    const fast = (ev.data?.travel as number) === 1;
    // 빠른 줄은 높고 날카롭게, 느린 줄은 낮고 둥글게
    a.blip(t, fast ? 880 : 523.25, 0.55, 'sine');
    if (fast) a.hat(t, 0.95);
  }

  playerSound(t: number, v: Verdict, a: AudioEngine): void {
    if (v === 'miss') {
      a.bad(t);
      return;
    }
    a.clap(t, v === 'perfect' ? 1.1 : 0.8);
    a.blip(t, v === 'perfect' ? 1046.5 : 783.99, 0.45, 'triangle');
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    drawStage(g, beat);

    const rope = getRopeState(beat, r.events);

    // 줄(rope) — 플레이어 뒤에 그려야 몸이 줄 앞으로 나온다
    drawRope(g, rope.midY, rope.alpha);

    // 양 옆 줄 돌리는 캐릭터
    drawTurner(g, HOLDER_LX, rope.midY, TURNER_L, beat);
    drawTurner(g, HOLDER_RX, rope.midY, TURNER_R, beat);

    drawJumper(g, r, beat);

    if (beat < LEAD_IN - 0.5) {
      text(g, '준비...', W / 2, 90, { size: 28, color: C.inkSoft, alpha: 0.6 });
    }
  }

  /** 설명 그림 — 줄이 한 바퀴 돌고 캐릭터가 그 위를 넘는다. */
  preview(g: CanvasRenderingContext2D, t: number): void {
    const gy = PREVIEW_H - 30;
    const handY = gy - 62;
    const top = handY - 42;
    const bot = gy + 8;

    // 줄 한 바퀴를 1.6초로. 앞 절반은 내려오고 뒤 절반은 올라간다.
    const u = (t % 1.6) / 1.6;
    const down = u < 0.5;
    const p = down ? u * 2 : 1 - (u - 0.5) * 2;
    // 실제 게임과 같은 이징 — 미리보기에서 익힌 감각이 그대로 통해야 한다.
    const midY = lerp(top, bot, down ? 1 - Math.cos(p * Math.PI * 0.5) : Math.sin(p * Math.PI * 0.5));

    // 줄이 바닥에 가까울수록 캐릭터가 떠 있다.
    const near = clamp((midY - (bot - 60)) / 60, 0, 1);
    const hop = near * 44;

    const lx = 96;
    const rx = PREVIEW_W - 96;
    g.strokeStyle = C.ink;
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(lx, handY);
    g.quadraticCurveTo(PREVIEW_W / 2, 2 * midY - handY, rx, handY);
    g.stroke();

    drawCharacter(g, { id: TURNER_L, x: lx - 14, y: gy, h: 76, armL: -0.9, armR: -0.9 });
    drawCharacter(g, { id: TURNER_R, x: rx + 14, y: gy, h: 76, armL: -0.9, armR: -0.9 });
    drawCharacter(g, {
      id: PLAYER_ID,
      x: PREVIEW_W / 2,
      y: gy,
      h: 88,
      hop,
      armL: -near * 0.7,
      armR: -near * 0.7,
      sing: near * 0.8,
    });
  }
}

// ---------------------------------------------------------------------------

/**
 * 줄 호(arc) 중점의 현재 Y 좌표를 반환한다.
 *
 * 우선순위:
 *   1. 지금 내려오고 있는 hit 구간  (pDown ∈ [0, 1])
 *   2. 방금 hit 이 끝나고 올라가는 중 (pUp ∈ [0, 1])
 *   3. 악구 사이 대기 — 살짝 흔들리는 휴식 위치
 *
 * 세 경우 모두 beat 의 순수 함수라 프레임이 밀려도 위치가 정확하다.
 */
function getRopeState(beat: number, events: BeatEvent[]): { midY: number; alpha: number } {
  // 1. 내려오는 중
  for (const ev of events) {
    if (ev.kind !== 'hit') continue;
    const from = ev.data!.from as number;
    const travel = ev.data!.travel as number;
    const p = (beat - from) / travel;
    if (p >= 0 && p <= 1) {
      /*
       * 천천히 시작해서 마지막에 확 떨어진다.
       *
       * 오래 `sin(p·π/2)` 를 쓰고 있었는데 그건 정반대 곡선이다 — 출발이 가장
       * 빠르고 타점에서 거의 멈춘다. 줄이 바닥 앞에서 기어들어오니 "언제 눌러야
       * 하는지"가 눈으로 안 잡혔고, 소리는 줄이 **출발하는** 박에만 나므로 귀로도
       * 보정이 안 됐다. 박자가 안 맞는다는 말이 나온 자리가 정확히 여기다.
       *
       * 1-cos 로 바꾸면 타점 직전 속도가 가장 빨라서, 줄이 바닥에 꽂히는 순간이
       * 한 프레임으로 딱 떨어진다.
       */
      const eased = 1 - Math.cos(p * Math.PI * 0.5);
      return { midY: lerp(ROPE_TOP, ROPE_BOT, eased), alpha: 1 };
    }
  }

  // 2. 올라가는 중
  for (const ev of events) {
    if (ev.kind !== 'hit') continue;
    const travel = ev.data!.travel as number;
    const returnDur = Math.max(travel * 0.55, 0.5);
    const pUp = (beat - ev.beat) / returnDur;
    if (pUp >= 0 && pUp <= 1) {
      const rem = 1 - pUp; // 1→0
      const eased = Math.sin(rem * Math.PI * 0.5) * rem; // 빠르게 올라간다
      return { midY: lerp(ROPE_TOP, ROPE_BOT, eased), alpha: 0.6 + rem * 0.4 };
    }
  }

  // 3. 대기 — 줄이 위에서 살랑살랑
  const sway = Math.sin(beat * Math.PI * 0.75) * 14;
  return { midY: ROPE_TOP + sway, alpha: 0.42 };
}

/**
 * 걸려 넘어진 정도. 0 = 멀쩡, 1 = 완전히 자빠짐.
 *
 * 넘어지는 건 빠르고 일어나는 건 느려야 "아차" 하는 느낌이 난다. 반대로 하면
 * 그냥 기우뚱하고 마는 것처럼 보인다.
 */
function tripAmount(beat: number, at: number | null): number {
  if (at === null) return 0;
  const since = beat - at;
  if (since < 0 || since > FALL_LEN) return 0;
  if (since < FALL_DOWN) return easeOut(since / FALL_DOWN, 2);
  return 1 - easeOut((since - FALL_DOWN) / (FALL_LEN - FALL_DOWN), 2);
}

/** 가운데서 뛰는 사람. 성공하면 뜨고, 놓치면 줄에 걸려 넘어진다. */
function drawJumper(g: CanvasRenderingContext2D, r: RenderInfo, beat: number): void {
  const lj = r.lastJudge;
  const hitOk = lj != null && lj.verdict !== 'miss';
  const playerSince = lj ? beat - lj.atBeat : 99;

  const trip = tripAmount(beat, lj?.verdict === 'miss' ? lj.atBeat : null);

  const nextHitBeat = nextBeat(r.events, 'hit', beat);
  // 정박 직전 무릎을 살짝 구부리는 예비 동작 — 이게 있어야 점프가 박자에 맞아 보인다
  const preJump = windUp(beat, nextHitBeat, 0.32) * 9;
  const jumpHop = hitOk ? easeOut(1 - clamp(playerSince / 0.78, 0, 1), 2) * 48 : 0;

  // 넘어지는 동안에는 예비동작도 점프도 없다. 몸이 바닥에 있어야 한다.
  const upright = 1 - trip;

  drawCharacter(g, {
    id: PLAYER_ID,
    x: PLAYER_X - trip * 26,
    y: GROUND_Y,
    h: BODY_H,
    // 자빠지면서 몸이 뒤로 눕는다. 발밑이 기준점이라 회전만으로 넘어짐이 된다.
    tilt: -trip * 1.15,
    squash: hitOk && lj ? decay(beat, lj.atBeat, 0.42, 3) * 0.4 : trip * 0.25,
    hop: (jumpHop + preJump) * upright,
    // 넘어지면 입이 벌어지고 눈이 질끈 감긴다.
    sing: hitOk && lj ? decay(beat, lj.atBeat, 0.42, 3) * 0.9 : trip * 0.9,
    blink: trip > 0.35 ? 1 : idleBlink(beat, 2),
    // 뜰수록 팔을 벌린다. 넘어질 땐 팔을 허우적거린다.
    armL: trip > 0 ? -0.9 - Math.sin(beat * 22) * 0.15 * trip : -clamp(jumpHop / 48, 0, 1) * 0.7,
    armR: trip > 0 ? -0.4 + Math.sin(beat * 22) * 0.2 * trip : -clamp(jumpHop / 48, 0, 1) * 0.7,
  });

  // 넘어진 자리에 흙먼지. 실패가 한눈에 보여야 한다.
  if (trip > 0.15) {
    g.save();
    g.globalAlpha = trip * 0.4;
    g.fillStyle = C.inkSoft;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI + (i / 3) * Math.PI;
      const d = 26 + (1 - trip) * 34;
      g.beginPath();
      g.ellipse(
        PLAYER_X + Math.cos(a) * d,
        GROUND_Y - 6 + Math.sin(a) * 6,
        10 + (1 - trip) * 8,
        6,
        0, 0, Math.PI * 2,
      );
      g.fill();
    }
    g.restore();
  }
}

/**
 * 2차 베지어 곡선으로 줄을 그린다.
 *
 * 좌·우 손에서 출발해 화면 중앙 위로 호를 그린다.
 * 제어점 y = 2 * midY - HAND_Y 이면 베지어 호의 중점이 정확히 midY 에 놓인다.
 *   B(0.5) = 0.25·HAND_Y + 0.5·ctrlY + 0.25·HAND_Y
 *          = 0.5·HAND_Y + 0.5·ctrlY = midY
 *   → ctrlY = 2·midY − HAND_Y
 */
function drawRope(g: CanvasRenderingContext2D, midY: number, alpha: number): void {
  const lx = HOLDER_LX + 40;
  const rx = HOLDER_RX - 40;
  const ctrlY = 2 * midY - HAND_Y;

  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = C.ink;
  g.lineWidth = 5.5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(lx, HAND_Y);
  g.quadraticCurveTo(W / 2, ctrlY, rx, HAND_Y);
  g.stroke();
  g.restore();
}

/**
 * 줄을 돌리는 좌·우 캐릭터.
 * 줄이 위에 있을수록 팔을 들고 있으니 몸이 살짝 위로 뜬다 (hop 으로 표현).
 */
function drawTurner(
  g: CanvasRenderingContext2D,
  x: number,
  midY: number,
  id: CastId,
  beat: number,
): void {
  const ropeRatio = clamp((ROPE_BOT - midY) / (ROPE_BOT - ROPE_TOP), 0, 1);
  drawCharacter(g, {
    id,
    x,
    y: GROUND_Y,
    h: TURNER_H,
    hop: ropeRatio * 16,
    // 줄이 위로 갈수록 팔도 같이 올라간다. 이제 팔이 실제로 줄을 돌린다.
    armL: -(0.45 + ropeRatio * 0.55),
    armR: -(0.45 + ropeRatio * 0.55),
    blink: idleBlink(beat, x),
  });
}
