import type { AudioEngine } from '../core/AudioEngine';
import { C, W, easeOut, text } from '../core/draw';
import type { BeatEvent, Verdict } from '../core/types';
import { shockRing } from './character';
import { CAST, drawCharacter } from './cast';
import { type MiniGame, type RenderInfo } from './MiniGame';
import { GROUND_Y, drawStage } from './stage';

/**
 * 노래 따라 부르기 — 콜 앤 리스폰스.
 *
 * 위 아래로 나뉜 두 합창단. 위쪽 6명(AI)이 프레이즈 앞 4박 동안 순서대로 소리를 내면,
 * 아래쪽 6명(플레이어)이 뒤 4박 동안 같은 시퀀스를 같은 타이밍에 그대로 따라 낸다.
 * 각 캐릭터는 Q W E · I O P 키에 매핑되어 있고, "삐 / 봉 / 짹 / 잉 / 웅 / 핑" 이라는
 * 서로 다른 목소리(합성된 이펙트음)를 낸다.
 *
 * 노트는 단일 또는 2명 동시. Runner 의 data.key 매칭 덕에 각 손가락이 자기 캐릭터
 * 이벤트만 소비한다.
 */

const LEAD_IN = 4;
const PHRASE_BEATS = 8;
const CALL_BEATS = 4;

const KEY_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyI', 'KeyO', 'KeyP'] as const;
const KEY_LABELS = ['Q', 'W', 'E', 'I', 'O', 'P'] as const;
const VOICE_NAMES = ['삐', '봉', '짹', '잉', '웅', '핑'] as const;
const CHAR_COLORS = [
  C.pink,     // Q
  C.yellow,   // W
  C.mint,     // E
  C.blue,     // I
  '#B983FF',  // O — purple
  '#FF9B7A',  // P — coral
] as const;

const CHAR_H = 96;
const AI_FEET_Y = 216;
const PLAYER_FEET_Y = 458;
const DIVIDER_Y = 264;
const SLOT_GAP = 120;
const FIRST_X = (W - SLOT_GAP * 5) / 2;

function charX(i: number): number {
  return FIRST_X + i * SLOT_GAP;
}

interface Chord {
  off: number;
  keys: number[];
}

const PATTERNS: Chord[][] = [
  [
    { off: 0, keys: [0] },
    { off: 1, keys: [3] },
    { off: 2, keys: [1] },
    { off: 3, keys: [5] },
  ],
  [
    { off: 0, keys: [0, 3] },
    { off: 1.5, keys: [1] },
    { off: 2.5, keys: [5] },
    { off: 3, keys: [2, 4] },
  ],
  [
    { off: 0, keys: [0] },
    { off: 0.5, keys: [3] },
    { off: 1.5, keys: [1, 4] },
    { off: 2.5, keys: [2] },
    { off: 3, keys: [5] },
  ],
  [
    { off: 0, keys: [0, 5] },
    { off: 1, keys: [1] },
    { off: 1.5, keys: [4] },
    { off: 2, keys: [2, 3] },
    { off: 3, keys: [0, 5] },
  ],
];

export class PianoRepeat implements MiniGame {
  readonly id = 'piano-repeat';
  readonly title = '6인 합창';
  readonly hint = '위 합창단이 낸 소리를 그대로 따라 내세요 — Q W E · I O P';
  readonly bpm = 116;
  readonly endBeat = LEAD_IN + PATTERNS.length * PHRASE_BEATS + 2;
  readonly order = 50;
  /**
   * 기본 자리(176)는 위 합창단(y 120~216) 한가운데라 문구가 캐릭터에 묻힌다.
   * 합창단 위 빈 띠로 올린다. 아래쪽은 "따라 하기!" 문구와 플레이어 합창단이
   * 차지하고 있어 비어 있는 높이가 여기뿐이다.
   */
  readonly verdictY = 82;
  readonly acceptedKeys = KEY_CODES;

  private events: BeatEvent[];

  constructor() {
    const out: BeatEvent[] = [];
    for (let i = 0; i < PATTERNS.length; i++) {
      const start = LEAD_IN + i * PHRASE_BEATS;
      for (const chord of PATTERNS[i]) {
        const cueBeat = start + chord.off;
        const hitBeat = cueBeat + CALL_BEATS;
        out.push({
          beat: cueBeat,
          kind: 'cue',
          data: { phrase: i, keys: chord.keys.join(',') },
        });
        for (const k of chord.keys) {
          out.push({
            beat: hitBeat,
            kind: 'hit',
            data: {
              phrase: i,
              keyIdx: k,
              key: KEY_CODES[k],
            },
          });
        }
      }
    }
    this.events = out.sort((a, b) => a.beat - b.beat);
  }

  build(): BeatEvent[] {
    return this.events;
  }

  groove(step: number, t: number, a: AudioEngine): void {
    // 부드러운 그루브 — 캐릭터 목소리가 튀도록 볼륨은 낮게.
    const inBar = step % 8;
    if (inBar === 0) a.kick(t, 0.7);
    if (inBar === 4) a.snare(t, 0.5);
    a.hat(t, inBar % 2 === 1 ? 0.35 : 0.15);
  }

  scheduleCue(ev: BeatEvent, t: number, a: AudioEngine): void {
    const keys = keysFromCue(ev);
    for (const k of keys) {
      playVoice(k, t, a);
    }
  }

  playerSound(t: number, v: Verdict, a: AudioEngine, ev?: BeatEvent): void {
    if (v === 'miss') {
      a.bad(t);
      return;
    }
    const idx = (ev?.data?.keyIdx as number | undefined) ?? 0;
    playVoice(idx, t, a);
  }

  draw(g: CanvasRenderingContext2D, r: RenderInfo): void {
    const { beat } = r;
    // 기본 위치(490)는 아래 합창단의 키 라벨(480)과 겹친다. 그 밑으로 내린다.
    drawStage(g, beat, GROUND_Y, 514);
    drawPhraseCounter(g, beat);
    drawPhaseLabel(g, beat);
    drawGroundLines(g);

    for (let i = 0; i < 6; i++) {
      const s = aiSing(r.events, i, beat);
      drawSinger(g, i, AI_FEET_Y, s, false);
    }

    for (let i = 0; i < 6; i++) {
      const s = playerSing(r.events, i, beat);
      const m = playerMissAge(r.events, i, beat);
      drawSinger(g, i, PLAYER_FEET_Y, s, true, m);
    }
  }
}

// ---------------------------------------------------------------------------
// 캐릭터 목소리 — 6명 각자 완전히 다른 톤.
// AudioEngine.output 에 붙여 volume 컨트롤을 그대로 탄다.

type VoiceFn = (t: number, a: AudioEngine) => void;

/** Q — 짧고 밝은 삐. 사인파가 위→아래로 미끄러진다. */
const voice_Q: VoiceFn = (t, a) => {
  const ctx = a.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(1046, t);
  o.frequency.exponentialRampToValueAtTime(660, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  o.connect(g).connect(a.output);
  o.start(t);
  o.stop(t + 0.32);
};

/** W — 뭉툭한 봉. 낮은 사각파를 로우패스로 눌러 벨처럼. */
const voice_W: VoiceFn = (t, a) => {
  const ctx = a.ctx;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(196, t);
  o.frequency.exponentialRampToValueAtTime(165, t + 0.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(lp).connect(g).connect(a.output);
  o.start(t);
  o.stop(t + 0.42);
};

/** E — 짹 두 음. 새 우는 소리. */
const voice_E: VoiceFn = (t, a) => {
  const ctx = a.ctx;
  const play = (freq: number, ts: number, dur: number, peak: number): void => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * 0.9, ts);
    o.frequency.exponentialRampToValueAtTime(freq, ts + dur * 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, ts);
    g.gain.exponentialRampToValueAtTime(peak, ts + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, ts + dur);
    o.connect(g).connect(a.output);
    o.start(ts);
    o.stop(ts + dur + 0.02);
  };
  play(880, t, 0.09, 0.3);
  play(1244, t + 0.075, 0.12, 0.28);
};

/** I — 위이잉. 톱니에 비브라토가 걸린다. */
const voice_I: VoiceFn = (t, a) => {
  const ctx = a.ctx;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(330, t);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 9;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain).connect(o.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1300;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
  o.connect(lp).connect(g).connect(a.output);
  o.start(t);
  o.stop(t + 0.45);
  lfo.start(t);
  lfo.stop(t + 0.45);
};

/** O — 저음 우웅. 두 옥타브 사인 겹치기. */
const voice_O: VoiceFn = (t, a) => {
  const ctx = a.ctx;
  const make = (freq: number, peak: number): void => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(a.output);
    o.start(t);
    o.stop(t + 0.55);
  };
  make(130.81, 0.34);
  make(261.63, 0.12);
};

/** P — 반짝 핑. 아주 짧고 밝게. */
const voice_P: VoiceFn = (t, a) => {
  const ctx = a.ctx;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1760, t);
  o.frequency.exponentialRampToValueAtTime(1318, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(a.output);
  o.start(t);
  o.stop(t + 0.25);
};

const VOICES: readonly VoiceFn[] = [voice_Q, voice_W, voice_E, voice_I, voice_O, voice_P];

function playVoice(keyIdx: number, t: number, a: AudioEngine): void {
  const fn = VOICES[keyIdx];
  if (fn) fn(t, a);
}

// ---------------------------------------------------------------------------

function keysFromCue(ev: BeatEvent): number[] {
  const s = ev.data?.keys as string | undefined;
  if (!s) return [];
  return s.split(',').map((x) => parseInt(x, 10));
}

interface SingState {
  amount: number;
  age: number;
  ringColor: string;
}

const NO_SING: SingState = { amount: 0, age: 0, ringColor: C.blue };
const SING_LEN = 0.7;

function aiSing(events: BeatEvent[], keyIdx: number, beat: number): SingState {
  let bestAge = Infinity;
  for (const ev of events) {
    if (ev.kind !== 'cue') continue;
    const keys = keysFromCue(ev);
    if (!keys.includes(keyIdx)) continue;
    const age = beat - ev.beat;
    if (age < 0 || age >= SING_LEN) continue;
    if (age < bestAge) bestAge = age;
  }
  if (!isFinite(bestAge)) return NO_SING;
  return {
    amount: easeOut(1 - bestAge / SING_LEN, 3),
    age: bestAge,
    ringColor: C.blue,
  };
}

function playerSing(events: BeatEvent[], keyIdx: number, beat: number): SingState {
  let bestAge = Infinity;
  let ringColor: string = C.mint;
  for (const ev of events) {
    if (ev.kind !== 'hit' || ev.data?.keyIdx !== keyIdx) continue;
    if (!ev.verdict || ev.verdict === 'miss') continue;
    const at = ev.pressedBeat ?? ev.beat;
    const age = beat - at;
    if (age < 0 || age >= SING_LEN) continue;
    if (age < bestAge) {
      bestAge = age;
      ringColor = ev.verdict === 'perfect' ? C.yellow : C.mint;
    }
  }
  if (!isFinite(bestAge)) return NO_SING;
  return {
    amount: easeOut(1 - bestAge / SING_LEN, 3),
    age: bestAge,
    ringColor,
  };
}

function playerMissAge(events: BeatEvent[], keyIdx: number, beat: number): number {
  const MISS_LEN = 1.4;
  let bestAge = Infinity;
  for (const ev of events) {
    if (ev.kind !== 'hit' || ev.data?.keyIdx !== keyIdx) continue;
    if (ev.verdict !== 'miss') continue;
    const at = ev.pressedBeat ?? ev.beat;
    const age = beat - at;
    if (age < 0 || age >= MISS_LEN) continue;
    if (age < bestAge) bestAge = age;
  }
  if (!isFinite(bestAge)) return 0;
  return 1 - bestAge / MISS_LEN;
}

function drawSinger(
  g: CanvasRenderingContext2D,
  i: number,
  feetY: number,
  s: SingState,
  showLabel: boolean,
  missAmount = 0,
): void {
  const x = charX(i);
  const color = CHAR_COLORS[i];
  const hop = s.amount * 12;

  // 노래 파동
  if (s.amount > 0) {
    const t = s.age / SING_LEN;
    shockRing(g, x, feetY - CHAR_H * 0.55, t, s.ringColor, 70);
  }

  // 여섯 명이 각자 다른 얼굴로 선다. i 는 키(Q~P) 순서라 캐릭터도 항상 같은 자리다.
  // 입은 cast.ts 가 캐릭터마다 다른 입 앵커에 맞춰 덧그린다 — 여기서 좌표를 잡지 않는다.
  drawCharacter(g, {
    id: CAST[i],
    x,
    y: feetY,
    h: CHAR_H,
    squash: s.amount * 0.15,
    hop,
    tilt: missAmount > 0 ? Math.sin(missAmount * 30) * 0.08 * missAmount : 0,
    sing: s.amount,
  });

  // 소리 이름 말풍선 — 확실히 티가 나게
  if (s.amount > 0) {
    drawSoundText(g, x, feetY - hop - CHAR_H, VOICE_NAMES[i], s.age, color);
  }

  if (showLabel) {
    text(g, KEY_LABELS[i], x, feetY + 22, {
      size: 16,
      color: s.amount > 0.2 ? C.ink : C.inkSoft,
      weight: 800,
      alpha: 0.55 + s.amount * 0.45,
    });
  }
}

/** 소리 이름을 캐릭터 위로 띄운다. 등장 순간이 커졌다가 살짝 흔들며 위로 올라감. */
function drawSoundText(
  g: CanvasRenderingContext2D,
  x: number,
  headY: number,
  label: string,
  age: number,
  color: string,
): void {
  const p = age / SING_LEN;
  const size = 26 + easeOut(1 - Math.min(age / 0.15, 1), 2) * 14; // 등장 순간 팝
  const yOff = -18 - p * 22;
  const sway = Math.sin(age * 12) * 4;
  const alpha = 1 - p * p;
  // 하얀 배경 아웃라인 (흰 배경에서도 보이도록)
  text(g, label, x + sway, headY + yOff, {
    size: size + 6,
    color: C.white,
    alpha: alpha * 0.9,
    weight: 900,
  });
  text(g, label, x + sway, headY + yOff, {
    size,
    color,
    alpha,
    weight: 900,
  });
}

function drawPhraseCounter(g: CanvasRenderingContext2D, beat: number): void {
  const phraseIdx = beat < LEAD_IN ? 0 : Math.floor((beat - LEAD_IN) / PHRASE_BEATS);
  if (phraseIdx >= PATTERNS.length) return;
  // 오른쪽 위는 PlayScene 의 콤보 자리다. 게임 제목 아래(왼쪽)로 붙인다.
  text(g, `${Math.min(phraseIdx + 1, PATTERNS.length)} / ${PATTERNS.length}`,
    22, 54, {
      size: 15, color: C.inkSoft, align: 'left', weight: 800, alpha: 0.7,
    });
}

function drawPhaseLabel(g: CanvasRenderingContext2D, beat: number): void {
  if (beat < LEAD_IN - 0.4) {
    text(g, '준비...', W / 2, DIVIDER_Y, {
      size: 22, color: C.inkSoft, alpha: 0.65,
    });
    return;
  }
  const local = ((beat - LEAD_IN) % PHRASE_BEATS + PHRASE_BEATS) % PHRASE_BEATS;
  const listening = local < CALL_BEATS;
  const label = listening ? '잘 듣고' : '따라 하기!';
  const color = listening ? C.blue : C.pink;
  const since = listening ? local : local - CALL_BEATS;
  const pop = since < 0.6 ? easeOut(1 - since / 0.6, 3) : 0;
  const yBase = DIVIDER_Y + (listening ? -18 : 22);
  text(g, label, W / 2, yBase, {
    size: 26 + pop * 10,
    color,
    alpha: 0.55 + pop * 0.45,
    weight: 900,
  });
}

function drawGroundLines(g: CanvasRenderingContext2D): void {
  g.save();
  g.strokeStyle = 'rgba(43, 42, 51, 0.1)';
  g.lineWidth = 2;
  g.setLineDash([6, 6]);
  const drawLine = (y: number): void => {
    g.beginPath();
    g.moveTo(FIRST_X - 60, y);
    g.lineTo(W - FIRST_X + 60, y);
    g.stroke();
  };
  drawLine(AI_FEET_Y);
  drawLine(PLAYER_FEET_Y);
  g.restore();
}
