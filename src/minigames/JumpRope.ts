import type { AudioEngine } from '../core/AudioEngine';
import { C, W, clamp, easeOut, lerp, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { drawCharacter, type CastId } from './cast';
import { basicGroove, type MiniGame, type RenderInfo } from './MiniGame';
import { decay, nextBeat, windUp } from './beat';
import { GROUND_Y, drawStage } from './stage';

/**
 * 줄넘기 — 올라갔다 내려오는 줄을 타이밍 맞춰 넘는다.
 *
 * 줄 잡는 캐릭터 둘이 양쪽에서 줄을 돌리면, 중앙 플레이어가 스페이스로 점프한다.
 * 줄의 호(arc) 중점은 순전히 beat 의 함수라 프레임이 밀려도 소리-그림이 어긋나지 않는다.
 *
 * 2박짜리 느린 줄에서 시작해 1박짜리 빠른 구간으로 올라가고, 마지막엔
 * 1박 연속 폭풍이 기다리고 있다.
 */

/** 각 악구를 구성하는 박 간격. 줄이 내려오는 데 걸리는 박 수. */
const PHRASES: number[][] = [
  [2, 2, 2, 2],           // 기본 — 두 박마다 한 번
  [2, 2, 2, 2],           // 반복으로 익히기
  [2, 2, 1, 1, 2],        // 1박 더블 첫 등장
  [1, 1, 2, 2, 2],        // 빠름으로 시작
  [2, 1, 1, 1, 1, 2],     // 빠른 구간 길어짐
  [1, 1, 1, 1, 1, 1, 2],  // 폭풍 — 이걸 버텨야 한다
];

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

export class JumpRope implements MiniGame {
  readonly id = 'jumprope';
  readonly title = '줄넘기';
  readonly hint = '줄이 발에 닿는 순간 점프! — 스페이스';
  readonly order = 30;
  readonly bpm = 116;
  readonly endBeat: number;

  constructor() {
    let t = LEAD_IN;
    for (const phrase of PHRASES) {
      for (const travel of phrase) t += travel;
      const sum = phrase.reduce((a, b) => a + b, 0);
      t += 2 + ((4 - ((sum + 2) % 4)) % 4);
    }
    this.endBeat = t + 2;
  }

  build(): BeatEvent[] {
    const out: BeatEvent[] = [];
    let t = LEAD_IN;
    for (const phrase of PHRASES) {
      for (const travel of phrase) {
        // cue: 줄이 내려오기 시작하는 박 → 소리로 예고
        out.push({ beat: t, kind: 'cue', data: { travel } });
        // hit: 줄이 바닥에 닿는 박 → 정확히 이 박에 스페이스
        out.push({ beat: t + travel, kind: 'hit', data: { travel, from: t } });
        t += travel;
      }
      const sum = phrase.reduce((a, b) => a + b, 0);
      // 다음 악구가 마디 머리(4의 배수)에서 시작하도록 쉼표 삽입
      t += 2 + ((4 - ((sum + 2) % 4)) % 4);
    }
    return out.sort((a, b) => a.beat - b.beat);
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
    drawTurner(g, HOLDER_LX, rope.midY, TURNER_L);
    drawTurner(g, HOLDER_RX, rope.midY, TURNER_R);

    // 플레이어
    const lj = r.lastJudge;
    const hitOk = lj != null && lj.verdict !== 'miss';
    const playerSince = lj ? beat - lj.atBeat : 99;
    const missShake = lj?.verdict === 'miss' ? decay(beat, lj.atBeat, 0.5) : 0;

    const nextHitBeat = nextBeat(r.events, 'hit', beat);
    // 정박 직전 무릎을 살짝 구부리는 예비 동작 — 이게 있어야 점프가 박자에 맞아 보인다
    const preJump = windUp(beat, nextHitBeat, 0.32) * 9;
    const jumpHop = hitOk ? easeOut(1 - clamp(playerSince / 0.78, 0, 1), 2) * 48 : 0;

    drawCharacter(g, {
      id: PLAYER_ID,
      x: PLAYER_X,
      y: GROUND_Y,
      h: BODY_H,
      squash: hitOk && lj ? decay(beat, lj.atBeat, 0.42, 3) * 0.4 : 0,
      hop: jumpHop + preJump,
      tilt: missShake * Math.sin(beat * 36) * 0.1,
      // 뛸 때 입이 벌어진다 — 힘주는 느낌.
      sing: hitOk && lj ? decay(beat, lj.atBeat, 0.42, 3) * 0.9 : 0,
    });

    if (beat < LEAD_IN - 0.5) {
      text(g, '준비...', W / 2, 90, { size: 28, color: C.inkSoft, alpha: 0.6 });
    }
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
      // sin(0→π/2): 천천히 시작해서 빠르게 내려온다 — 긴장감이 생긴다
      const eased = Math.sin(p * Math.PI * 0.5);
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
): void {
  const ropeRatio = clamp((ROPE_BOT - midY) / (ROPE_BOT - ROPE_TOP), 0, 1);
  drawCharacter(g, {
    id,
    x,
    y: GROUND_Y,
    h: TURNER_H,
    hop: ropeRatio * 16,
  });
}
