import type { BeatEvent } from '../core/types';
import type { Rng } from '../core/rng';

/**
 * 미니게임들이 공통으로 쓰는 박자 유틸.
 *
 * 여기 있는 함수는 전부 "박(beat)을 넣으면 값이 나오는" 순수 함수다.
 * 내부에 상태를 두지 않으므로 프레임이 튀어도 결과가 어긋나지 않는다.
 * 새 미니게임을 만들 때 비슷한 걸 또 만들지 말고 여기서 가져다 쓰거나,
 * 없으면 여기에 추가하자.
 */

/**
 * 타점 직후 1에서 0으로 떨어지는 감쇠 곡선. 캐릭터가 "쳤다"는 걸 표현하는
 * 스쿼시·스윙·반짝임에 전부 쓴다.
 *
 * @param beat     현재 박
 * @param at       타점이 일어난 박. null 이면 (아직 안 쳤으면) 0을 돌려준다.
 * @param duration 몇 박에 걸쳐 가라앉을지
 * @param power    클수록 처음에 급격히 떨어지고 꼬리가 길다
 */
export function decay(beat: number, at: number | null, duration: number, power = 2): number {
  if (at === null) return 0;
  const since = beat - at;
  if (since < 0 || since > duration) return 0;
  return Math.pow(1 - since / duration, power);
}

/**
 * 다음 타점이 다가올수록 0에서 1로 커지는 예비동작 양.
 *
 * 리듬게임에서 동작이 "박자에 맞아 보이는" 건 대부분 이 예비동작 덕분이다.
 * 정박에 맞춰 움직이기만 하면 늦어 보이고, 그 직전에 크게 준비하는 동작이
 * 있어야 정박에 딱 꽂히는 것처럼 읽힌다.
 */
export function windUp(beat: number, next: number | null, window = 0.45): number {
  if (next === null) return 0;
  const until = next - beat;
  if (until < 0 || until > window) return 0;
  return 1 - until / window;
}

/** 지금까지 지나온 이벤트 중 마지막 것의 박. 없으면 null. */
export function prevBeat(
  events: BeatEvent[],
  kind: BeatEvent['kind'],
  beat: number,
): number | null {
  let prev: number | null = null;
  for (const e of events) {
    if (e.kind !== kind) continue;
    if (e.beat <= beat) prev = e.beat;
    else break;
  }
  return prev;
}

/** 아직 오지 않은 이벤트 중 가장 가까운 것의 박. 없으면 null. */
export function nextBeat(
  events: BeatEvent[],
  kind: BeatEvent['kind'],
  beat: number,
): number | null {
  for (const e of events) {
    if (e.kind === kind && e.beat > beat) return e.beat;
  }
  return null;
}

/**
 * 직전과 다음을 한 번에. 목록을 한 번만 훑으므로,
 * 둘 다 필요하면 prevBeat/nextBeat 를 따로 부르는 것보다 낫다.
 *
 * 주의: events 는 박 순으로 정렬돼 있어야 한다 (build() 에서 sort 해두면 된다).
 */
export function prevAndNext(
  events: BeatEvent[],
  kind: BeatEvent['kind'],
  beat: number,
): { prev: number | null; next: number | null } {
  let prev: number | null = null;
  for (const e of events) {
    if (e.kind !== kind) continue;
    if (e.beat <= beat) prev = e.beat;
    else return { prev, next: e.beat };
  }
  return { prev, next: null };
}

/**
 * "간격의 목록"으로 이루어진 채보를 위한 악구 생성기.
 *
 * 줄넘기·튕겨내기·양궁은 형태가 같다 — 신호가 오고, 정해진 박 뒤에 타점이 오고,
 * 그 간격이 짧을수록 어렵다. 셋이 각자 뽑으면 같은 코드가 세 벌 생기므로 여기 둔다.
 *
 * 고정 배열을 쓰지 않는 이유는 하나다. 몇 판만 하면 통째로 외워지고, 그 뒤로는
 * 반응이 아니라 암기로 친다. 규칙(어떤 간격이 얼마나 자주, 몇 개까지 연달아)만
 * 난이도가 정하고 실제 배치는 매 판 새로 뽑는다.
 */
export interface PhraseSpec {
  /** 만들 악구 수. */
  phrases: number;
  /** 한 악구의 타점 개수 범위. */
  notes: [number, number];
  /** [간격(박), 가중치]. 가중치가 클수록 자주 나온다. */
  travels: readonly (readonly [number, number])[];
  /** 가장 빠른 간격이 연달아 붙을 수 있는 최대 개수. 0 이면 아예 안 쓴다. */
  maxRun: number;
}

export function makeTravelPhrases(rng: Rng, spec: PhraseSpec): number[][] {
  const fastest = Math.min(...spec.travels.map(([b]) => b));
  const out: number[][] = [];

  for (let i = 0; i < spec.phrases; i++) {
    // 뒤 악구일수록 가장 빠른 간격의 가중치가 최대 두 배까지 오른다.
    // 한 판 안에서도 상승이 있어야 마지막 악구가 절정으로 읽힌다.
    const ramp = spec.phrases > 1 ? i / (spec.phrases - 1) : 0;
    const weights = spec.travels.map(
      ([b, w]) => [b, b === fastest ? w * (1 + ramp) : w] as const,
    );

    const count =
      spec.notes[0] +
      Math.round(rng() * (spec.notes[1] - spec.notes[0]));

    const phrase: number[] = [];
    let run = 0;
    for (let n = 0; n < count; n++) {
      // 연속 제한에 걸렸으면 가장 빠른 간격은 후보에서 빼고 다시 뽑는다.
      // 쉼표 없이 최속만 이어지면 실력이 아니라 손목이 버티는 문제가 된다.
      const pool =
        run >= spec.maxRun ? weights.filter(([b]) => b !== fastest) : weights;
      const travel = weightedPick(rng, pool.length > 0 ? pool : weights);
      phrase.push(travel);
      run = travel === fastest ? run + 1 : 0;
    }

    // 악구 첫 타점은 가장 빠른 간격으로 시작하지 않는다 — 들어가는 문턱을 낮춘다.
    if (phrase[0] === fastest && weights.length > 1) {
      const slower = weights.filter(([b]) => b !== fastest);
      phrase[0] = weightedPick(rng, slower);
    }
    out.push(phrase);
  }

  return out;
}

function weightedPick(rng: Rng, pairs: readonly (readonly [number, number])[]): number {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/**
 * 악구들을 이어 붙여 cue/hit 짝을 만든다.
 *
 * cue 는 "신호가 오는 박", hit 은 "눌러야 하는 박"이고 그 사이가 travel 이다.
 * 악구 사이에는 최소 2박을 쉬되, 다음 악구가 마디 머리(4의 배수)에서 시작하도록
 * 맞춘다 — 그루브와 어긋난 자리에서 새 악구가 시작하면 박을 놓친다.
 *
 * @returns 이벤트와, 마지막 타점 뒤의 박.
 */
export function layoutPhrases(
  phrases: number[][],
  leadIn: number,
): { events: BeatEvent[]; endBeat: number } {
  const events: BeatEvent[] = [];
  let t = leadIn;

  for (const phrase of phrases) {
    for (const travel of phrase) {
      events.push({ beat: t, kind: 'cue', data: { travel } });
      events.push({ beat: t + travel, kind: 'hit', data: { travel, from: t } });
      t += travel;
    }
    const sum = phrase.reduce((a, b) => a + b, 0);
    t += 2 + ((4 - ((sum + 2) % 4)) % 4);
  }

  events.sort((a, b) => a.beat - b.beat);
  return { events, endBeat: t };
}
