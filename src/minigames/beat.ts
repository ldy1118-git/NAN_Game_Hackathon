import type { BeatEvent } from '../core/types';

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
