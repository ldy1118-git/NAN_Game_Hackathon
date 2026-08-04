import type { AudioEngine } from '../core/AudioEngine';
import { C, circle, clamp, easeOut, lerp, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { shockRing } from './character';
import { drawCharacter, idleBlink, type CastId } from './cast';
import { basicGroove, type MiniGame, type RenderInfo } from './MiniGame';
import { decay, nextBeat, prevAndNext, windUp } from './beat';
import { GROUND_Y, drawStage } from './stage';

/**
 * 따라 치기 — 리듬천국의 기본형인 콜 앤 리스폰스.
 *
 * 왼쪽 로봇이 4박짜리 패턴을 손뼉으로 들려주면, 다음 4박 동안 플레이어가 똑같이 친다.
 * 소리만으로도 칠 수 있지만, 로봇이 친 손뼉이 "메아리 점"이 되어 4박에 걸쳐
 * 플레이어 쪽으로 날아온다. 점이 손에 닿는 순간이 정확히 눌러야 하는 순간이라,
 * 귀로 기억한 박자와 눈으로 보는 위치가 같은 지점에서 만난다.
 */

/** 4박 안에서의 손뼉 위치들. 뒤로 갈수록 잘게 쪼개진다. */
const PATTERNS: number[][] = [
  [0, 1, 2, 3],
  [0, 1, 2, 2.5],
  [0, 1.5, 2, 3],
  [0, 0.5, 1, 2],
  [0, 1, 1.5, 2.5],
  [0.5, 1, 2, 2.5, 3],
  [0, 0.5, 1.5, 2, 3],
  [0, 0.5, 1, 1.5, 2.5, 3],
];

const LEAD_IN = 4;      // 그루브가 자리잡을 여유
const PHRASE = 8;       // 콜 4박 + 리스폰스 4박
const BOT_X = 268;
const PLAYER_X = 700;
const BODY_H = 150;
/** 왼쪽이 들려주고 오른쪽이 따라 친다. */
const BOT_ID: CastId = 'girl2';
const PLAYER_ID: CastId = 'man1';
/** 두 손이 모이는 높이. 캐릭터가 손뼉칠 때 손이 오는 자리(배 앞)와 같다. */
const HAND_Y = GROUND_Y - BODY_H * 0.3;
/** 손뼉 직후 몸이 눌렸다 돌아오는 데 걸리는 박. */
const CLAP_DECAY = 0.55;

export class ClapBot implements MiniGame {
  readonly id = 'clapbot';
  readonly title = '따라 치기';
  readonly hint = '로봇이 친 손뼉을 그대로 따라 치세요 — 스페이스';
  readonly order = 10;   // 가장 기본형 — 여기서 시작
  readonly bpm = 124;
  readonly endBeat = LEAD_IN + PATTERNS.length * PHRASE + 2;

  build(): BeatEvent[] {
    const out: BeatEvent[] = [];
    PATTERNS.forEach((pattern, i) => {
      const start = LEAD_IN + i * PHRASE;
      for (const off of pattern) {
        // 콜: 로봇이 친다. 이 박에서 메아리 점이 출발한다.
        out.push({ beat: start + off, kind: 'cue', data: { phrase: i } });
        // 리스폰스: 정확히 4박 뒤, 점이 도착하는 순간.
        out.push({
          beat: start + 4 + off,
          kind: 'hit',
          data: { phrase: i, from: start + off },
        });
      }
    });
    return out.sort((a, b) => a.beat - b.beat);
  }

  groove(step: number, t: number, a: AudioEngine): void {
    basicGroove(step, t, a);
  }

  scheduleCue(_ev: BeatEvent, t: number, a: AudioEngine): void {
    a.clap(t, 1);
    a.blip(t, 587.33, 0.4, 'triangle'); // 로봇 손뼉에 얹는 음정 — 낮은 D
  }

  playerSound(t: number, v: Verdict, a: AudioEngine): void {
    if (v === 'miss') {
      a.bad(t);
      return;
    }
    a.clap(t, 1.1);
    // 완벽하면 옥타브 위로 — 잘 맞췄다는 걸 귀로 먼저 안다.
    a.blip(t, v === 'perfect' ? 1174.66 : 880, 0.5, 'triangle');
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;

    drawStage(g, beat);
    this.drawPhaseLabel(g, beat);

    // --- 날아가는 메아리 점 ---
    // 판정이 끝난 점은 손뼉 연출로 대체되므로 그리지 않는다.
    for (const ev of r.events) {
      if (ev.kind !== 'hit' || ev.verdict) continue;
      const p = (beat - (ev.data!.from as number)) / 4;
      if (p < 0 || p > 1) continue;
      drawEcho(g, p);
    }

    // --- 로봇 ---
    const botClap = prevAndNext(r.events, 'cue', beat);
    const botSince = botClap.prev === null ? 99 : beat - botClap.prev;
    drawCharacter(g, {
      id: BOT_ID,
      x: BOT_X,
      y: GROUND_Y,
      h: BODY_H,
      squash: decay(beat, botClap.prev, CLAP_DECAY, 2.4),
      hop: botSince < 0.5 ? easeOut(1 - botSince / 0.5, 2) * 8 : 0,
      // 손뼉과 함께 입도 벌어진다 — 눈을 못 감기게 된 만큼 반응을 입으로 돌린다.
      sing: decay(beat, botClap.prev, CLAP_DECAY, 3) * 0.8,
      blink: idleBlink(beat, 0),
      armL: clapArm(handOpen(beat, botClap)),
      armR: clapArm(handOpen(beat, botClap)),
    });
    if (botSince < 0.55) shockRing(g, BOT_X, HAND_Y, botSince / 0.55, C.blue, 62);

    // --- 플레이어 ---
    const lj = r.lastJudge;
    const playerSince = lj ? beat - lj.atBeat : 99;
    const hitOk = lj != null && lj.verdict !== 'miss';
    const nextHit = nextBeat(r.events, 'hit', beat);
    const playerArm = clapArm(
      handOpen(beat, { prev: hitOk && lj ? lj.ev.beat : null, next: nextHit }),
    );
    drawCharacter(g, {
      id: PLAYER_ID,
      x: PLAYER_X,
      y: GROUND_Y,
      h: BODY_H,
      squash: hitOk && lj ? decay(beat, lj.atBeat, CLAP_DECAY, 2.4) : 0,
      hop: hitOk && playerSince < 0.5 ? easeOut(1 - playerSince / 0.5, 2) * 8 : 0,
      tilt: !hitOk && playerSince < 0.6 ? Math.sin(playerSince * 40) * 0.06 : 0,
      sing: hitOk && lj ? decay(beat, lj.atBeat, CLAP_DECAY, 3) * 0.8 : 0,
      blink: idleBlink(beat, 3),
      armL: playerArm,
      armR: playerArm,
    });
    if (hitOk && playerSince < 0.55) {
      shockRing(g, PLAYER_X, HAND_Y, playerSince / 0.55, C.pink, 62);
    }
  }

  private drawPhaseLabel(g: CanvasRenderingContext2D, beat: number): void {
    if (beat < LEAD_IN - 0.5) return;
    const local = (beat - LEAD_IN) % PHRASE;
    const listening = local < 4;
    const label = listening ? '잘 듣고' : '따라 치기!';
    const color = listening ? C.inkSoft : C.pink;
    // 구간이 바뀌는 순간 살짝 커졌다 돌아온다.
    const since = listening ? local : local - 4;
    const pop = since < 0.6 ? easeOut(1 - since / 0.6, 3) : 0;
    text(g, label, 480, 96, { size: 30 + pop * 12, color, alpha: 0.5 + pop * 0.5 });
  }
}

// ---------------------------------------------------------------------------

/**
 * 손 벌림 정도를 캐릭터 팔 값으로 옮긴다.
 * 1 = 두 손이 앞에서 만남(손뼉), 0 = 옆으로 내림, 음수 = 위로 치켜듦(예비동작).
 */
function clapArm(open: number): number {
  return clamp(1 - open, -0.5, 1);
}

/**
 * 손 벌림 정도. 친 직후엔 붙어 있다가 벌어지고, 다음 타점 직전엔 예비동작으로
 * 크게 벌린다. 이 예비동작이 있어야 손뼉이 "박자에 맞아 보인다".
 */
function handOpen(beat: number, cl: { prev: number | null; next: number | null }): number {
  const since = cl.prev === null ? 99 : beat - cl.prev;
  if (since < 0.08) return 0.04;

  const open = clamp(since / 0.4, 0, 1);
  const wind = windUp(beat, cl.next, 0.45);
  return wind > 0 ? Math.max(open, 1) * (1 + wind * 0.55) : open;
}

/** 메아리 점의 궤적. 로봇의 오른손에서 플레이어의 왼손까지. */
const ECHO_FROM = BOT_X + 66;
const ECHO_TO = PLAYER_X - 66;

function echoAt(p: number): [number, number] {
  return [lerp(ECHO_FROM, ECHO_TO, p), HAND_Y - Math.sin(p * Math.PI) * 128];
}

/**
 * 메아리 점. 로봇이 친 손뼉이 정확히 4박에 걸쳐 플레이어의 손으로 날아간다.
 * 위치가 오직 p(=박의 함수)로만 정해지므로 프레임이 튀어도 도착 시점은 밀리지 않는다.
 */
function drawEcho(g: CanvasRenderingContext2D, p: number): void {
  const near = easeOut(p, 4); // 가까워질수록 커지고 진해진다

  g.save();
  g.fillStyle = C.yellow;
  for (let i = 3; i >= 1; i--) {
    const [tx, ty] = echoAt(clamp(p - i * 0.02, 0, 1));
    g.globalAlpha = (0.3 + near * 0.4) * (1 - i * 0.24);
    circle(g, tx, ty, 10 - i * 1.8);
    g.fill();
  }

  const [x, y] = echoAt(p);
  g.globalAlpha = 0.45 + near * 0.55;
  g.fillStyle = C.yellow;
  circle(g, x, y, 10 + near * 5);
  g.fill();
  g.strokeStyle = C.ink;
  g.lineWidth = 3;
  g.stroke();
  g.restore();
}
